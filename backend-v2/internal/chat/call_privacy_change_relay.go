package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

const callPrivacyChannel = "crane_call_privacy_changed"

func CallPrivacyChangeRelay(ctx context.Context, databaseURL string, db *sql.DB, realtime userBroadcaster) {
	relayNotifications(ctx, databaseURL, callPrivacyChannel, func(raw string) error {
		return broadcastCallPrivacyChange(ctx, db, realtime, raw)
	})
}

func broadcastCallPrivacyChange(ctx context.Context, db *sql.DB, realtime userBroadcaster, raw string) error {
	var event struct {
		UserID string `json:"userId"`
	}
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		return err
	}
	owner, err := uuid.Parse(event.UserID)
	if err != nil || owner == uuid.Nil {
		return fmt.Errorf("invalid call privacy owner")
	}
	// Только затронутые личные чаты; viewer-specific DTO каждый читает сам.
	rows, err := db.QueryContext(ctx, `SELECT c.id::text,m.user_id::text FROM chats.chats c
 JOIN chats.members owner ON owner.chat_id=c.id AND owner.user_id=$1
 JOIN chats.members m ON m.chat_id=c.id WHERE c.type='private'`, owner.String())
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var chatID, viewer string
		if err := rows.Scan(&chatID, &viewer); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]string{"type": "chat_updated", "chatId": chatID})
		if err != nil {
			return err
		}
		realtime.BroadcastToUsers([]string{viewer}, payload)
	}
	return rows.Err()
}
