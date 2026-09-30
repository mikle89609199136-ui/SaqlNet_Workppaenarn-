package chat

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/lib/pq"
)

// MaxDeleteBatch — сколько сообщений удаляется одним запросом: столько же,
// сколько отправляется пачкой (#809) и сколько можно выбрать.
const MaxDeleteBatch = 100

// DeleteMessages удаляет выбранные сообщения одного чата (#840): у всех или
// только у себя. Всё или ничего: одно недоступное сообщение — и не
// удаляется ни одно.
//
//   - У всех — только свои сообщения (как в макете; удаление чужих
//     администратором — отдельная задача). Остальным участникам и другим
//     устройствам удалившего уходит messages_deleted.
//   - У себя — любые сообщения чата, где пользователь участник. Остальные
//     их по-прежнему видят; другим устройствам этого пользователя уходит
//     messages_hidden.
//
// Возвращает последнее сообщение чата, каким его теперь видит пользователь,
// — для превью в списке чатов.
func (s *Service) DeleteMessages(ctx context.Context, userID, chatID string, messageIDs []string, forEveryone bool) (*Message, error) {
	if err := validate.Var(chatID, "required,uuid"); err != nil {
		return nil, ErrInvalidInput
	}
	ids, err := uniqueMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var isMember bool
	if err := tx.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`,
		chatID, userID,
	).Scan(&isMember); err != nil {
		return nil, err
	}
	if !isMember {
		return nil, ErrForbidden
	}

	// Блокировка строк: параллельное удаление тех же сообщений ждёт, а не
	// удаляет второй раз.
	rows, err := tx.QueryContext(ctx, `
		SELECT id::text, COALESCE(sender_id::text, '')
		FROM messages.messages
		WHERE chat_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
		FOR UPDATE
	`, chatID, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	found := 0
	allOwn := true
	for rows.Next() {
		var id, senderID string
		if err := rows.Scan(&id, &senderID); err != nil {
			_ = rows.Close()
			return nil, err
		}
		found++
		if senderID != userID {
			allOwn = false
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if found != len(ids) {
		// Чужой чат, уже удалённое или несуществующее — для вызывающего одно
		// и то же: такого сообщения здесь нет.
		return nil, ErrNotFound
	}

	if forEveryone {
		if !allOwn {
			return nil, ErrForbidden
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE messages.messages SET deleted_at = NOW()
			WHERE chat_id = $1 AND id = ANY($2::uuid[])
		`, chatID, pq.Array(ids)); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO messages.hidden_messages (user_id, message_id)
			SELECT $1, unnest($2::uuid[])
			ON CONFLICT DO NOTHING
		`, userID, pq.Array(ids)); err != nil {
			return nil, err
		}
	}

	lastMessage, err := s.loadMessageAfterDelete(ctx, tx, userID, chatID, nil, ids[0], userID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	s.announceDeleted(chatID, userID, ids, forEveryone)
	return lastMessage, s.hideSenderPhotos(ctx, userID, lastMessage)
}

// announceDeleted рассылает событие после коммита. Одно событие на пачку,
// а не по сообщению: иначе клиент перечитывал бы чат сто раз подряд.
func (s *Service) announceDeleted(chatID, userID string, ids []string, forEveryone bool) {
	if s.ws == nil {
		return
	}
	eventType := "messages_hidden"
	if forEveryone {
		eventType = "messages_deleted"
	}
	payload, _ := json.Marshal(map[string]any{
		"type":       eventType,
		"chatId":     chatID,
		"messageIds": ids,
	})
	if forEveryone {
		// Всем участникам, включая другие устройства удалившего.
		s.ws.BroadcastToChat(chatID, payload, "")
		return
	}
	// Скрытое касается только этого пользователя — всех его устройств.
	s.ws.BroadcastToUsers([]string{userID}, payload)
}

func uniqueMessageIDs(messageIDs []string) ([]string, error) {
	if len(messageIDs) == 0 || len(messageIDs) > MaxDeleteBatch {
		return nil, ErrInvalidInput
	}
	seen := make(map[string]struct{}, len(messageIDs))
	ids := make([]string, 0, len(messageIDs))
	for _, id := range messageIDs {
		if err := validate.Var(id, "required,uuid"); err != nil {
			return nil, ErrInvalidInput
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

// nullableUUID — пустая строка как NULL для необязательного параметра uuid.
func nullableUUID(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}
