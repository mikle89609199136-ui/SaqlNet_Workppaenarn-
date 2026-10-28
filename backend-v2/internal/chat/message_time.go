package chat

import (
	"time"

	"github.com/lib/pq"
)

// Keep the existing updatedAt field, with one UTC wire representation. No
// rounding: PostgreSQL microseconds survive across REST and WebSocket reads.
func canonicalMessageTime(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		parsed, err = pq.ParseTimestamp(nil, value)
	}
	if err != nil {
		return value
	}
	return parsed.UTC().Format(time.RFC3339Nano)
}

func normalizeMessageTimes(message *Message) {
	message.CreatedAt = canonicalMessageTime(message.CreatedAt)
	message.UpdatedAt = canonicalMessageTime(message.UpdatedAt)
	if !message.IsEdited {
		message.UpdatedAt = message.CreatedAt
	}
}
