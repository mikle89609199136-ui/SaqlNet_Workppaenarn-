package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"craneapp/backend-v2/internal/platform/profileevent"
	"github.com/lib/pq"
)

type userBroadcaster interface {
	BroadcastToUsers(userIDs []string, message []byte)
}

// ProfileChangeRelay forwards committed profile changes to every connected
// account sharing a chat with the changed user. PostgreSQL delivers NOTIFY only
// after the rename transaction commits, so clients never observe uncommitted data.
func ProfileChangeRelay(ctx context.Context, databaseURL string, db *sql.DB, realtime userBroadcaster) {
	relayNotifications(ctx, databaseURL, profileevent.Channel, func(payload string) error {
		return broadcastProfileChange(ctx, db, realtime, payload)
	})
}

// relayNotifications слушает канал NOTIFY и передаёт каждое уведомление в
// handle, пока не отменён ctx. Ошибки обработки только логируются.
func relayNotifications(ctx context.Context, databaseURL, channel string, handle func(payload string) error) {
	listener := pq.NewListener(databaseURL, time.Second, 30*time.Second, func(event pq.ListenerEventType, err error) {
		if err != nil {
			slog.Warn("notification listener", "channel", channel, "event", event, "error", err)
		}
	})
	defer listener.Close()
	if err := listener.Listen(channel); err != nil {
		slog.Error("listen for notifications", "channel", channel, "error", err)
		return
	}

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-listener.Notify:
			if !ok {
				return
			}
			if notification == nil {
				continue
			}
			if err := handle(notification.Extra); err != nil {
				slog.Warn("relay notification", "channel", channel, "error", err)
			}
		case <-ping.C:
			if err := listener.Ping(); err != nil {
				slog.Warn("ping notification listener", "channel", channel, "error", err)
			}
		}
	}
}

func broadcastProfileChange(ctx context.Context, db *sql.DB, realtime userBroadcaster, rawEvent string) error {
	var event profileevent.UsernameChanged
	if err := json.Unmarshal([]byte(rawEvent), &event); err != nil {
		return fmt.Errorf("decode event: %w", err)
	}
	if event.UserID == "" || event.Username == "" {
		return fmt.Errorf("profile change event is incomplete")
	}
	// Имя в «печатает» (#866) может быть username: кеш участников — заново.
	if cache, ok := realtime.(interface{ InvalidateUserProfile(string) }); ok {
		cache.InvalidateUserProfile(event.UserID)
	}

	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT recipient_id::text
		FROM (
			SELECT peer.user_id AS recipient_id
			FROM chats.members source
			JOIN chats.members peer ON peer.chat_id = source.chat_id
			WHERE source.user_id = $1
			UNION ALL
			SELECT $1::uuid
		) recipients
	`, event.UserID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var recipients []string
	for rows.Next() {
		var recipient string
		if err := rows.Scan(&recipient); err != nil {
			return err
		}
		recipients = append(recipients, recipient)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	payload, err := json.Marshal(map[string]any{
		"type":    profileevent.UsernameChangedType,
		"payload": event,
	})
	if err != nil {
		return err
	}
	realtime.BroadcastToUsers(recipients, payload)
	return nil
}
