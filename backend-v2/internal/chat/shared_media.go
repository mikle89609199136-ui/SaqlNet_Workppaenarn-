package chat

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"github.com/lib/pq"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
)

// Общее в переписке для панели профиля (#842): фото и видео, файлы, текст
// (ссылки клиент собирает сам — они внутри шифровки) — по виду, от новых к
// старым, с курсором. И позиция сообщения в ленте, чтобы клиент догрузил
// её до старого сообщения.

const (
	DefaultSharedLimit = 30
	MaxSharedLimit     = 60
)

// sharedKinds — вид выдачи и типы сообщений в нём.
var sharedKinds = map[string][]string{
	"media": {"image", "video"},
	"files": {"file", "audio"},
	"text":  {"text"},
}

// ErrInvalidCursor — курсор не сообщение этого чата.
var ErrInvalidCursor = errors.New("cursor is not a message of the chat")

// ErrMessageNotFound — сообщения нет в чате, оно удалено или скрыто у себя.
var ErrMessageNotFound = errors.New("message not found")

// SharedPage — страница общего: сообщения от новых к старым и курсор
// следующей (id последнего сообщения); пусто — дальше ничего нет.
type SharedPage struct {
	Messages   []Message `json:"messages"`
	NextCursor string    `json:"nextCursor,omitempty"`
}

// memberAccess — как у ленты: чата нет — ErrNotFound, чужой — ErrForbidden.
func (s *Service) memberAccess(ctx context.Context, userID, chatID string) error {
	ok, err := s.IsMember(ctx, userID, chatID)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	var chatExists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM chats.chats WHERE id = $1)", chatID).Scan(&chatExists); err != nil {
		return err
	}
	if !chatExists {
		return ErrNotFound
	}
	return ErrForbidden
}

// ListShared — сообщения чата вида kind, старше сообщения before (пусто —
// с самых новых). Правила — как у ленты: только участнику, без удалённых и
// скрытых у себя.
func (s *Service) ListShared(ctx context.Context, userID, chatID, kind, before string, limit int) (SharedPage, error) {
	types, ok := sharedKinds[kind]
	if !ok || limit < 1 || limit > MaxSharedLimit {
		return SharedPage{}, ErrInvalidInput
	}
	if err := s.memberAccess(ctx, userID, chatID); err != nil {
		return SharedPage{}, err
	}

	var cursor any
	if before != "" {
		var exists bool
		if err := s.db.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM messages.messages WHERE id = $1 AND chat_id = $2)`,
			before, chatID,
		).Scan(&exists); err != nil {
			return SharedPage{}, err
		}
		if !exists {
			return SharedPage{}, ErrInvalidCursor
		}
		cursor = before
	}

	// Одно лишнее — чтобы знать, есть ли следующая страница. Порядок
	// (время, id) строгий: сообщения пачки с одинаковым временем не
	// теряются и не повторяются на границе страниц.
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id::text, m.chat_id::text, m.sender_id::text,
		       COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
		       m.content, m.entities, m.type, m.reply_to::text, m.metadata,
		       (p.message_id IS NOT NULL), m.updated_at > m.created_at,
		       m.created_at::text, m.updated_at::text, m.deleted_at::text
		FROM messages.messages m
		LEFT JOIN auth.users au ON au.id = m.sender_id
		LEFT JOIN users.profiles up ON up.user_id = m.sender_id
		LEFT JOIN messages.pins p ON p.message_id = m.id
		WHERE m.chat_id = $1 AND m.deleted_at IS NULL
		  AND m.type = ANY($2::text[])
		  AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = m.id AND hm.user_id = $3)
		  AND ($4::uuid IS NULL OR (m.created_at, m.id) < (
		        SELECT c.created_at, c.id FROM messages.messages c WHERE c.id = $4::uuid))
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT $5
	`, chatID, pq.Array(types), userID, cursor, limit+1)
	if err != nil {
		return SharedPage{}, err
	}
	defer rows.Close()
	messages, err := scanMessages(rows)
	if err != nil {
		return SharedPage{}, err
	}

	page := SharedPage{Messages: messages}
	if len(messages) > limit {
		page.Messages = messages[:limit]
		page.NextCursor = page.Messages[limit-1].ID
	}
	if page.Messages == nil {
		page.Messages = []Message{}
	}
	if err := s.hydrateMessagesReactions(ctx, userID, page.Messages); err != nil {
		return SharedPage{}, err
	}
	if err := s.hydrateMessagesFields(ctx, userID, page.Messages); err != nil {
		return SharedPage{}, err
	}
	return page, s.hideMessageListPhotos(ctx, userID, page.Messages)
}

// MessagePosition — сколько видимых зрителю сообщений ленты новее этого:
// клиент догружает ленту страницами, пока не дойдёт до него.
func (s *Service) MessagePosition(ctx context.Context, userID, chatID, messageID string) (int, error) {
	if err := s.memberAccess(ctx, userID, chatID); err != nil {
		return 0, err
	}
	var position sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		WITH target AS (
			SELECT t.created_at FROM messages.messages t
			WHERE t.id = $2 AND t.chat_id = $1 AND t.deleted_at IS NULL
			  AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = t.id AND hm.user_id = $3)
		)
		SELECT (
			SELECT COUNT(*) FROM messages.messages m
			WHERE m.chat_id = $1 AND m.deleted_at IS NULL
			  AND m.created_at > target.created_at
			  AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = m.id AND hm.user_id = $3)
		)
		FROM target
	`, chatID, messageID, userID).Scan(&position)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrMessageNotFound
	}
	if err != nil {
		return 0, err
	}
	return int(position.Int64), nil
}

// ListShared — GET /api/v2/chats/{chatID}/shared?kind=&before=&limit=.
func (h *Handler) ListShared(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	chatID := r.PathValue("chatID")
	query := r.URL.Query()
	kind := query.Get("kind")
	before := query.Get("before")

	if validate.Var(chatID, "required,uuid") != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid chatId")
		return
	}
	if _, ok := sharedKinds[kind]; !ok {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "kind must be media, files or text")
		return
	}
	if before != "" && validate.Var(before, "uuid") != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid before")
		return
	}
	limit := DefaultSharedLimit
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > MaxSharedLimit {
			httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "limit must be 1 to 60")
			return
		}
		limit = parsed
	}

	page, err := h.service.ListShared(r.Context(), current.ID, chatID, kind, before, limit)
	switch {
	case errors.Is(err, ErrInvalidCursor):
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_cursor", "before is not a message of this chat")
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat_not_found")
	case errors.Is(err, ErrForbidden):
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access_denied")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to list shared messages")
	default:
		httpx.JSON(w, http.StatusOK, page)
	}
}

// MessagePosition — GET /api/v2/chats/{chatID}/messages/{messageID}/position.
func (h *Handler) MessagePosition(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	chatID := r.PathValue("chatID")
	messageID := r.PathValue("messageID")
	if validate.Var(chatID, "required,uuid") != nil || validate.Var(messageID, "required,uuid") != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "validation_failed", "invalid chatId or messageId")
		return
	}

	position, err := h.service.MessagePosition(r.Context(), current.ID, chatID, messageID)
	switch {
	case errors.Is(err, ErrMessageNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "message_not_found", "message_not_found")
	case errors.Is(err, ErrNotFound):
		httpx.ErrorJSON(w, r, http.StatusNotFound, "chat_not_found", "chat_not_found")
	case errors.Is(err, ErrForbidden):
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", "access_denied")
	case err != nil:
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "failed to find message position")
	default:
		httpx.JSON(w, http.StatusOK, map[string]int{"position": position})
	}
}
