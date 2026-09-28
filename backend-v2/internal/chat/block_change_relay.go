package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"craneapp/backend-v2/internal/platform/blockevent"
)

// BlockChangeRelay сообщает о блокировке и её снятии обоим по WebSocket
// (#760). Заблокированный сразу видит, что писать и звонить нельзя, а
// статус собеседника скрыт; заблокировавший — на остальных своих
// устройствах. Клиент по событию перечитывает данные чата: флаги
// isBlockedByPeer / isPeerBlocked и статус считает сервер.
func BlockChangeRelay(ctx context.Context, databaseURL string, db *sql.DB, realtime userBroadcaster) {
	relayNotifications(ctx, databaseURL, blockevent.Channel, func(payload string) error {
		return broadcastBlockChange(ctx, db, realtime, payload)
	})
}

func broadcastBlockChange(ctx context.Context, db *sql.DB, realtime userBroadcaster, rawEvent string) error {
	var event blockevent.Changed
	if err := json.Unmarshal([]byte(rawEvent), &event); err != nil {
		return fmt.Errorf("decode event: %w", err)
	}
	if event.UserID == "" || event.BlockedUserID == "" {
		return fmt.Errorf("block event is incomplete")
	}

	// Личный чат этих двоих, если он есть.
	var chatID string
	err := db.QueryRowContext(ctx, `
		SELECT c.id::text
		FROM chats.chats c
		JOIN chats.members a ON a.chat_id = c.id AND a.user_id = $1
		JOIN chats.members b ON b.chat_id = c.id AND b.user_id = $2
		WHERE c.type = 'private'
		LIMIT 1
	`, event.UserID, event.BlockedUserID).Scan(&chatID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	eventType := blockevent.UnblockedType
	if event.Blocked {
		eventType = blockevent.BlockedType
	}
	payload, err := json.Marshal(map[string]any{
		"type":          eventType,
		"userId":        event.UserID,
		"blockedUserId": event.BlockedUserID,
		"chatId":        chatID,
	})
	if err != nil {
		return err
	}
	realtime.BroadcastToUsers([]string{event.UserID, event.BlockedUserID}, payload)
	return nil
}
