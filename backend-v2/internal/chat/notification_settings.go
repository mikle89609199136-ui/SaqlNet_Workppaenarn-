package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Membership and the personal setting are checked/written in one statement.
// Repeating the same value is safe and leaves other chat settings untouched.
const setNotificationPreviewQuery = `
 INSERT INTO chats.user_chat_settings (user_id, chat_id, hide_notification_preview)
 SELECT user_id, chat_id, $3 FROM chats.members WHERE user_id = $1 AND chat_id = $2
 ON CONFLICT (user_id, chat_id) DO UPDATE
 SET hide_notification_preview = EXCLUDED.hide_notification_preview
`

func (s *Service) SetNotificationPreview(ctx context.Context, userID, chatID string, hidden bool) error {
	if validate.Var(userID, "uuid") != nil || validate.Var(chatID, "uuid") != nil {
		return ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, setNotificationPreviewQuery, userID, chatID, hidden)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrForbidden
	}
	return nil
}

// SetPersonalMute меняет только оповещения владельца; писать в чат и звонить
// по-прежнему можно. Отсутствующий until означает бессрочное отключение.
func (s *Service) SetPersonalMute(ctx context.Context, userID, chatID string, muted bool, until *time.Time) error {
	if validate.Var(userID, "uuid") != nil || validate.Var(chatID, "uuid") != nil ||
		(until != nil && (!muted || !until.After(time.Now()))) {
		return ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO chats.user_chat_settings (user_id, chat_id, notifications_muted_at, notifications_muted_until)
		SELECT user_id, chat_id, CASE WHEN $3 THEN NOW() ELSE NULL END, $4::timestamptz
		FROM chats.members WHERE user_id=$1 AND chat_id=$2
		ON CONFLICT (user_id, chat_id) DO UPDATE
		SET notifications_muted_at=EXCLUDED.notifications_muted_at,
		    notifications_muted_until=EXCLUDED.notifications_muted_until
	`, userID, chatID, muted, until)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrForbidden
	}
	return nil
}

func (h *Handler) personalMute(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	if r.Method == http.MethodDelete {
		respondSuccess(w, r, h.service.SetPersonalMute(r.Context(), userID, chatID, false, nil))
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r)
		return
	}
	var raw json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		respondSuccess(w, r, ErrInvalidInput)
		return
	}
	for key := range object {
		if key != "mutedUntil" {
			respondSuccess(w, r, ErrInvalidInput)
			return
		}
	}
	var until *time.Time
	if value, ok := object["mutedUntil"]; ok {
		var timestamp *string
		if err := json.Unmarshal(value, &timestamp); err != nil {
			respondSuccess(w, r, ErrInvalidInput)
			return
		}
		if timestamp != nil {
			parsed, err := time.Parse(time.RFC3339Nano, *timestamp)
			if err != nil {
				respondSuccess(w, r, ErrInvalidInput)
				return
			}
			utc := parsed.UTC()
			until = &utc
		}
	}
	respondSuccess(w, r, h.service.SetPersonalMute(r.Context(), userID, chatID, true, until))
}
