package chat

import (
	"errors"
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
		Content         *string        `json:"content"`
		Type            string         `json:"type"`
		ReplyTo         *string        `json:"replyTo"`
		MediaURL        string         `json:"mediaUrl"`
		MediaType       string         `json:"mediaType"`
		FileName        string         `json:"fileName"`
		SizeBytes       int64          `json:"sizeBytes"`
		MediaEncrypted  bool           `json:"mediaEncrypted"`
		MediaEncryption map[string]any `json:"mediaEncryption"`
		IsEncrypted     bool           `json:"isEncrypted"`
	}

	if !decode(w, r, &input) {
		return
	}

	if input.Type == "" {
		input.Type = string(MessageTypeText)
	}

	if !isAllowedClientMessageType(input.Type) {
		httpx.ErrorJSON(
			w,
			r,
			http.StatusBadRequest,
			"validation_failed",
			"unsupported message type",
		)
		return
	}

	content := ""
	if input.Content != nil {
		content = *input.Content
	}

	switch input.Type {
	case "text":
		if strings.TrimSpace(content) == "" {
			httpx.ErrorJSON(
				w, r,
				http.StatusBadRequest,
				"validation_failed",
				"message content is required",
			)
			return
		}

	case "sticker":
		if strings.TrimSpace(content) != "" {
			httpx.ErrorJSON(
				w, r,
				http.StatusBadRequest,
				"validation_failed",
				"sticker cannot have a caption",
			)
			return
		}
	}

	if input.Type != "text" && strings.TrimSpace(input.MediaURL) == "" {
		httpx.ErrorJSON(
			w,
			r,
			http.StatusBadRequest,
			"validation_failed",
			"mediaUrl is required for media messages",
		)
		return
	}

	var metadata map[string]any
	if input.MediaURL != "" {
		fileName, sizeBytes, err := h.service.ValidateMediaMetadata(r.Context(), input.MediaURL, input.FileName, input.SizeBytes, input.MediaEncrypted)
		if errors.Is(err, ErrInvalidInput) {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_media_metadata", "fileName or sizeBytes does not match the uploaded file")
			return
		}

		if err != nil {
			httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to validate media metadata")
			return
		}

		metadata = map[string]any{
			"mediaUrl":        input.MediaURL,
			"mediaType":       input.MediaType,
			"fileName":        fileName,
			"sizeBytes":       sizeBytes,
			"mediaEncrypted":  input.MediaEncrypted,
			"mediaEncryption": input.MediaEncryption,
			"isEncrypted":     input.IsEncrypted,
		}
	}
	msg, err := h.service.SendMessage(r.Context(), current.ID, targetID, content, input.Type, input.ReplyTo, metadata)

	if errors.Is(err, ErrMemberMuted) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "member_muted", "member is muted")
		return
	}

	if errors.Is(err, ErrForbidden) {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access denied")
		return
	}

	if errors.Is(err, ErrInvalidInput) {
		httpx.ErrorJSON(
			w, r,
			http.StatusBadRequest,
			"validation_failed",
			"invalid replyTo",
		)
		return
	}

	if errors.Is(err, ErrNotFound) {
		httpx.ErrorJSON(
			w, r,
			http.StatusNotFound,
			"reply_not_found",
			"reply message not found",
		)
		return
	}

	if err != nil {
		slog.Error("send message failed", "err", err, "chatId", targetID, "userId", current.ID, "type", input.Type)
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to send message")
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"message": msg})
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
		Content *string `json:"content"`
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

	msg, err := h.service.EditMessage(r.Context(), current.ID, targetID, content)

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
