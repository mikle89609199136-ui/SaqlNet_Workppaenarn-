package chat

import "context"

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
