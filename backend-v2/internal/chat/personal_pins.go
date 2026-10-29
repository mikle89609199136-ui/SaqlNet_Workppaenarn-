package chat

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

type PersonalPinsPage struct {
	Pins       []Pin  `json:"pins"`
	NextCursor string `json:"nextCursor,omitempty"`
}

type personalPinCursor struct {
	Time      time.Time `json:"t"`
	MessageID string    `json:"id"`
}

// The membership and message locks serialize writes with leave/kick/ban and
// soft deletion. Membership FK cascades cleanup in the revocation transaction.
func personalPinAccess(ctx context.Context, tx *sql.Tx, userID, chatID, messageID string) error {
	var dummy int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM chats.members WHERE chat_id=$1 AND user_id=$2 FOR SHARE`, chatID, userID).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if messageID == "" {
		return nil
	}
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM messages.messages m WHERE m.id=$1 AND m.chat_id=$2 AND m.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$3) FOR SHARE`, messageID, chatID, userID).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (s *Service) SetPersonalPin(ctx context.Context, userID, chatID, messageID string, pinned bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err = personalPinAccess(ctx, tx, userID, chatID, messageID); err != nil {
		return err
	}
	var pinnedAt time.Time
	var changed bool
	if pinned {
		err = tx.QueryRowContext(ctx, `INSERT INTO messages.personal_pins(user_id,chat_id,message_id) VALUES($1,$2,$3) ON CONFLICT(user_id,message_id) DO NOTHING RETURNING pinned_at`, userID, chatID, messageID).Scan(&pinnedAt)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		changed = err == nil
	} else {
		result, execErr := tx.ExecContext(ctx, `DELETE FROM messages.personal_pins WHERE user_id=$1 AND chat_id=$2 AND message_id=$3`, userID, chatID, messageID)
		if execErr != nil {
			return execErr
		}
		count, affectedErr := result.RowsAffected()
		if affectedErr != nil {
			return affectedErr
		}
		changed = count > 0
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if changed && s.ws != nil {
		eventType := "message_personal_unpinned"
		if pinned {
			eventType = "message_personal_pinned"
		}
		event := map[string]any{"type": eventType, "scope": "personal", "chatId": chatID, "messageId": messageID, "isPersonalPinned": pinned}
		if pinned {
			event["pinnedAt"] = pinnedAt.UTC().Format(time.RFC3339Nano)
		}
		payload, _ := json.Marshal(event)
		s.ws.BroadcastToUsers([]string{userID}, payload)
	}
	return nil
}

func (s *Service) ListPersonalPins(ctx context.Context, userID, chatID, cursor string, limit int) (PersonalPinsPage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		return PersonalPinsPage{}, ErrInvalidInput
	}
	var before *time.Time
	var beforeID *string
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		var value personalPinCursor
		if len(cursor) > 1024 || err != nil || json.Unmarshal(raw, &value) != nil || value.Time.IsZero() || validate.Var(value.MessageID, "required,uuid") != nil {
			return PersonalPinsPage{}, ErrInvalidInput
		}
		before = &value.Time
		beforeID = &value.MessageID
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return PersonalPinsPage{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err = personalPinAccess(ctx, tx, userID, chatID, ""); err != nil {
		return PersonalPinsPage{}, err
	}
	rows, err := tx.QueryContext(ctx, `
 SELECT p.message_id::text,p.chat_id::text,p.pinned_at,
 m.sender_id::text,COALESCE(up.first_name,au.first_name,au.username,''),COALESCE(up.avatar_url,''),
 m.content,m.entities,m.type,m.reply_to::text,m.metadata,m.updated_at>m.created_at,m.created_at::text,m.updated_at::text,
 EXISTS(SELECT 1 FROM messages.pins cp WHERE cp.message_id=m.id)
 FROM messages.personal_pins p JOIN messages.messages m ON m.id=p.message_id AND m.chat_id=p.chat_id
 LEFT JOIN auth.users au ON au.id=m.sender_id LEFT JOIN users.profiles up ON up.user_id=m.sender_id
 WHERE p.user_id=$1 AND p.chat_id=$2 AND m.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$1)
 AND ($3::timestamptz IS NULL OR (p.pinned_at,p.message_id)<($3,$4::uuid))
 ORDER BY p.pinned_at DESC,p.message_id DESC LIMIT $5`, userID, chatID, before, beforeID, limit+1)
	if err != nil {
		return PersonalPinsPage{}, err
	}
	page := PersonalPinsPage{Pins: make([]Pin, 0, limit)}
	var last personalPinCursor
	for rows.Next() {
		if len(page.Pins) == limit {
			raw, _ := json.Marshal(last)
			page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
			break
		}
		var pin Pin
		var at time.Time
		var reply sql.NullString
		var metadata []byte
		err = rows.Scan(&pin.MessageID, &pin.ChatID, &at, &pin.Message.SenderID, &pin.Message.SenderName, &pin.Message.SenderAvatar, &pin.Message.Content, &pin.Message.Entities, &pin.Message.Type, &reply, &metadata, &pin.Message.IsEdited, &pin.Message.CreatedAt, &pin.Message.UpdatedAt, &pin.Message.IsPinned)
		if err != nil {
			_ = rows.Close()
			return PersonalPinsPage{}, err
		}
		pin.ID = pin.MessageID
		pin.PinnedBy = userID
		pin.PinnedAt = at.UTC().Format(time.RFC3339Nano)
		pin.Message.ID = pin.MessageID
		pin.Message.ChatID = pin.ChatID
		pin.Message.IsChatPinned = pin.Message.IsPinned
		pin.Message.IsPersonalPinned = true
		if reply.Valid {
			pin.Message.ReplyTo = &reply.String
		}
		if len(metadata) > 0 {
			if err = json.Unmarshal(metadata, &pin.Message.Metadata); err != nil {
				_ = rows.Close()
				return PersonalPinsPage{}, err
			}
		}
		page.Pins = append(page.Pins, pin)
		last = personalPinCursor{Time: at, MessageID: pin.MessageID}
	}
	if err = rows.Err(); err != nil {
		_ = rows.Close()
		return PersonalPinsPage{}, err
	}
	if err = rows.Close(); err != nil {
		return PersonalPinsPage{}, err
	}
	if err = tx.Commit(); err != nil {
		return PersonalPinsPage{}, err
	}
	pointers := make([]*Message, len(page.Pins))
	for i := range page.Pins {
		if err = s.hydrateMessageFields(ctx, userID, &page.Pins[i].Message); err != nil {
			return PersonalPinsPage{}, err
		}
		pointers[i] = &page.Pins[i].Message
	}
	return page, s.hideSenderPhotos(ctx, userID, pointers...)
}
