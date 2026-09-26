package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	targetID := r.PathValue("chatId")

	if err := validate.Var(targetID, "required,uuid"); err != nil {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid chatId",
		)
		return
	}

	limit, offset := parsePagination(r)
	msgs, err := h.service.ListMessages(r.Context(), current.ID, targetID, limit, offset)
	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat_not_found")
		return
	}
	if errors.Is(err, ErrForbidden) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access_denied")
		return
	}
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list messages")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

// maxMessagesPerSend — сколько сообщений принимает одна отправка (#808).
// Столько же позволяет выбрать и переслать за раз Telegram.
const maxMessagesPerSend = 100

// sendBodyLimit — предел тела отправки. Общих 256 КБ не хватает на сотню
// зашифрованных сообщений: конверт в полтора раза длиннее текста.
const sendBodyLimit = 2 << 20

// sendMessageItem — одно сообщение из отправки: то же тело, что раньше
// принимала одиночная отправка.
type sendMessageItem struct {
	Entities        json.RawMessage `json:"entities"`
	Content         *string         `json:"content"`
	Type            string          `json:"type"`
	ReplyTo         *string         `json:"replyTo"`
	MediaURL        string          `json:"mediaUrl"`
	MediaType       string          `json:"mediaType"`
	FileName        string          `json:"fileName"`
	SizeBytes       int64           `json:"sizeBytes"`
	MediaEncrypted  bool            `json:"mediaEncrypted"`
	MediaEncryption map[string]any  `json:"mediaEncryption"`
	IsEncrypted     bool            `json:"isEncrypted"`
	ForwardedFrom   *string         `json:"forwardedFrom"`
}

// SendMessage — отправка сообщений в чат, всегда пачкой (#808).
//
// Одно сообщение — пачка из одного: путь записи один и для обычной
// отправки, и для пересылки нескольких сообщений с комментарием. Каждое
// сообщение проверяется до записи; на ошибке отвечаем номером сообщения
// в details.index, и не пишется ничего.
func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	targetID := r.PathValue("chatId")

	if err := validate.Var(targetID, "required,uuid"); err != nil {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid chatId",
		)
		return
	}

	var input struct {
		Messages []sendMessageItem `json:"messages"`
	}

	if !decodeLimited(w, r, &input, sendBodyLimit) {
		return
	}

	if len(input.Messages) == 0 || len(input.Messages) > maxMessagesPerSend {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			fmt.Sprintf("messages must contain from 1 to %d items", maxMessagesPerSend),
		)
		return
	}

	outgoing := make([]OutgoingMessage, 0, len(input.Messages))
	for i, item := range input.Messages {
		out, ok := h.prepareOutgoing(w, r, current.ID, targetID, i, item)
		if !ok {
			return
		}
		outgoing = append(outgoing, out)
	}

	msgs, err := h.service.SendMessages(r.Context(), current.ID, targetID, outgoing)

	if errors.Is(err, ErrMemberMuted) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "member_muted", "member is muted")
		return
	}

	if errors.Is(err, ErrBlockedByUser) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "blocked_by_user", "you are blocked by this user")
		return
	}

	if errors.Is(err, ErrForbidden) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
		return
	}

	var itemErr *MessageItemError
	if errors.As(err, &itemErr) {
		switch {
		case errors.Is(itemErr.Err, ErrInvalidInput):
			itemErrorJSON(w, r, itemErr.Index, http.StatusBadRequest, "validation_failed", itemErr.Err.Error())
			return
		case errors.Is(itemErr.Err, ErrNotFound):
			itemErrorJSON(w, r, itemErr.Index, http.StatusNotFound, "reply_not_found", "reply message not found")
			return
		}
	}

	if err != nil {
		slog.Error("send messages failed", "err", err, "chatId", targetID, "userId", current.ID, "count", len(outgoing))
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to send message")
		return
	}

	httpx.JSON(w, http.StatusCreated, map[string]any{"messages": msgs})
}

// prepareOutgoing проверяет одно сообщение из пачки и собирает его
// metadata: файл сверяется с загруженным, автор пересылаемого берётся с
// сервера. На ошибке отвечает сам и возвращает false.
func (h *Handler) prepareOutgoing(w http.ResponseWriter, r *http.Request, userID, chatID string, index int, item sendMessageItem) (OutgoingMessage, bool) {
	if item.Type == "" {
		item.Type = string(MessageTypeText)
	}

	if !isAllowedClientMessageType(item.Type) {
		itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", "unsupported message type")
		return OutgoingMessage{}, false
	}

	content := ""
	if item.Content != nil {
		content = *item.Content
	}

	entities, err := parseMessageEntities(content, item.Entities)
	if err != nil {
		itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", err.Error())
		return OutgoingMessage{}, false
	}
	if item.Type == "sticker" && len(entities) != 0 {
		itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", "entities must be empty for sticker")
		return OutgoingMessage{}, false
	}

	switch item.Type {
	case "text":
		if strings.TrimSpace(content) == "" {
			itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", "message content is required")
			return OutgoingMessage{}, false
		}

	case "sticker":
		if content != "" {
			itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", "sticker cannot have a caption")
			return OutgoingMessage{}, false
		}
	}

	if item.Type != "text" && strings.TrimSpace(item.MediaURL) == "" {
		itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", "mediaUrl is required for media messages")
		return OutgoingMessage{}, false
	}

	var metadata map[string]any
	if item.MediaURL != "" {
		fileName, sizeBytes, err := h.service.ValidateMediaMetadata(r.Context(), item.MediaURL, item.FileName, item.SizeBytes, item.MediaEncrypted)
		if errors.Is(err, ErrInvalidInput) {
			itemErrorJSON(w, r, index, http.StatusBadRequest, "invalid_media_metadata", "fileName or sizeBytes does not match the uploaded file")
			return OutgoingMessage{}, false
		}

		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to validate media metadata")
			return OutgoingMessage{}, false
		}

		metadata = map[string]any{
			"mediaUrl":        item.MediaURL,
			"mediaType":       item.MediaType,
			"fileName":        fileName,
			"sizeBytes":       sizeBytes,
			"mediaEncrypted":  item.MediaEncrypted,
			"mediaEncryption": item.MediaEncryption,
			"isEncrypted":     item.IsEncrypted,
		}
	}

	// Пересылка — это отправка с forwardedFrom: клиент уже зашифровал
	// содержимое ключом этого чата (см. Service.ForwardOrigin), а автора
	// находит сервер. Имя от клиента не берётся никогда.
	if item.ForwardedFrom != nil && *item.ForwardedFrom != "" {
		source, err := h.service.ForwardOrigin(r.Context(), userID, *item.ForwardedFrom)
		if errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrNotFound) {
			itemErrorJSON(w, r, index, http.StatusBadRequest, "validation_failed", "invalid forwardedFrom")
			return OutgoingMessage{}, false
		}
		if err != nil {
			slog.Error("resolve forwarded message failed", "err", err, "chatId", chatID, "userId", userID)
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to send message")
			return OutgoingMessage{}, false
		}
		if metadata == nil {
			metadata = map[string]any{}
		}
		source.Apply(metadata)
	}

	return OutgoingMessage{
		Content:  content,
		Entities: entities,
		Type:     item.Type,
		ReplyTo:  item.ReplyTo,
		Metadata: metadata,
	}, true
}

// itemErrorJSON — ошибка одного сообщения из пачки: номер сообщения
// уходит в details.index.
func itemErrorJSON(w http.ResponseWriter, r *http.Request, index, status int, code, message string) {
	httpx.JSON(w, status, httpx.Error{
		Code:      code,
		Message:   message,
		RequestID: r.Header.Get("X-Request-ID"),
		Details:   map[string]any{"index": index},
	})
}

func (h *Handler) EditMessage(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	targetID := r.PathValue("messageId")

	if err := validate.Var(targetID, "required,uuid"); err != nil {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid messageId",
		)
		return
	}

	var input struct {
		Entities json.RawMessage `json:"entities"`
		Content  *string         `json:"content"`
	}

	if !decode(w, r, &input) {
		return
	}

	if input.Content == nil {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"message content is required",
		)
		return
	}

	content := *input.Content
	entities, err := parseMessageEntities(content, input.Entities)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	msg, err := h.service.EditMessage(r.Context(), current.ID, targetID, content, entities)

	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.ErrorJSON(
			w,
			r,
			http.StatusBadRequest,
			"validation_failed",
			"text message content is required",
		)
	case errors.Is(err, ErrStickerCannotBeEdited):
		httpx.ErrorJSON(
			w,
			r,
			http.StatusBadRequest,
			"validation_failed",
			"sticker cannot be edited",
		)
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(
			w,
			r,
			http.StatusNotFound,
			"message_not_found",
			"message not found",
		)
	case err != nil:
		httpx.ErrorJSON(
			w,
			r,
			http.StatusInternalServerError,
			"internal_error",
			"failed to edit message",
		)
	default:
		httpx.JSON(w, http.StatusOK, msg)
	}
}

func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	targetID := r.PathValue("messageId")

	lastMessage, err := h.service.DeleteMessage(r.Context(), current.ID, targetID)
	if err != nil {
		respondSuccess(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"lastMessage": lastMessage,
	})
}

func (h *Handler) ListReactions(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	targetID := r.PathValue("messageId")

	reactions, err := h.service.ListReactions(
		r.Context(),
		current.ID,
		targetID,
	)

	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.ErrorJSON(
				w, r,
				http.StatusNotFound,
				"not_found",
				"message not found",
			)
		case errors.Is(err, ErrForbidden):
			httpx.ErrorJSON(
				w, r,
				http.StatusForbidden,
				"access_denied",
				"access denied",
			)
		case errors.Is(err, ErrInvalidInput):
			httpx.ErrorJSON(
				w, r,
				http.StatusBadRequest,
				"validation_failed",
				"invalid messageId",
			)
		default:
			httpx.ErrorJSON(
				w, r,
				http.StatusInternalServerError,
				"internal_error",
				"failed to list reactions",
			)
		}
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"reactions": reactions,
	})
}

func (h *Handler) MarkMessagesRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r)
		return
	}
	current := authctx.MustUser(r)
	var input struct {
		ChatID     string   `json:"chatId"`
		MessageIDs []string `json:"messageIds"`
	}
	if !decode(w, r, &input) {
		return
	}

	if err := validate.Var(input.ChatID, "required,uuid"); err != nil {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid chatId",
		)
		return
	}

	err := h.service.MarkRead(r.Context(), current.ID, input.ChatID)
	respondSuccess(w, r, err)
}

// parsePagination извлекает limit и offset из query-параметров запроса
// с дефолтными значениями (50 и 0 соответственно).
func parsePagination(r *http.Request) (int, int) {
	limit := 50
	offset := 0
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		offset = o
	}
	return limit, offset
}
