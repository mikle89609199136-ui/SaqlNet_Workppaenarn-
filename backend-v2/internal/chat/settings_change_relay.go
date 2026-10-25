package chat

import (
	"context"
	"encoding/json"
	"fmt"

	"craneapp/backend-v2/internal/platform/settingsevent"
	"github.com/google/uuid"
)

// SettingsChangeRelay sends committed invalidations to all sockets of the owner.
// Chat peers never receive this event. Missed NOTIFY is repaired by client refetch.
func SettingsChangeRelay(ctx context.Context, databaseURL string, realtime userBroadcaster) {
	relayNotifications(ctx, databaseURL, settingsevent.Channel, func(payload string) error {
		return broadcastSettingsChange(realtime, payload)
	})
}

func broadcastSettingsChange(realtime userBroadcaster, raw string) error {
	var event settingsevent.Changed
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		return fmt.Errorf("decode settings event: %w", err)
	}
	owner, err := uuid.Parse(event.UserID)
	if err != nil || owner == uuid.Nil || event.Version != settingsevent.Version {
		return fmt.Errorf("invalid settings event")
	}
	event.UserID = owner.String()
	payload, err := json.Marshal(map[string]any{"type": settingsevent.Type, "payload": event})
	if err != nil {
		return err
	}
	realtime.BroadcastToUsers([]string{event.UserID}, payload)
	return nil
}
