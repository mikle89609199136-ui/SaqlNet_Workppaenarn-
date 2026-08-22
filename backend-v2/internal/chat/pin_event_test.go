package chat

import (
	"encoding/json"
	"testing"
)

func TestMessagePinnedPayloadContainsPin(t *testing.T) {
	pin := Pin{
		ID:        "pin-1",
		MessageID: "message-1",
		ChatID:    "chat-1",
		PinnedBy:  "user-1",
		PinnedAt:  "2026-08-07T10:00:00Z",
		Message: Message{
			ID:      "message-1",
			ChatID:  "chat-1",
			Content: "important",
		},
	}

	payload, err := messagePinnedPayload(pin)
	if err != nil {
		t.Fatalf("messagePinnedPayload() error = %v", err)
	}

	var event struct {
		Type      string `json:"type"`
		ChatID    string `json:"chatId"`
		MessageID string `json:"messageId"`
		Pin       Pin    `json:"pin"`
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}

	if event.Type != "message_pinned" || event.ChatID != pin.ChatID || event.MessageID != pin.MessageID {
		t.Fatalf("unexpected event envelope: %+v", event)
	}
	if event.Pin.ID != pin.ID || event.Pin.Message.ID != pin.Message.ID || event.Pin.Message.Content != pin.Message.Content {
		t.Fatalf("event pin = %+v, want %+v", event.Pin, pin)
	}
}
