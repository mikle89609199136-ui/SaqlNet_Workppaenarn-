package chat

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCanonicalMessageTimes(t *testing.T) {
	for _, value := range []string{"2026-10-29 01:02:03.123456+00", "2026-10-29 04:02:03.123456+03", "2026-10-29T01:02:03.123456Z"} {
		require.Equal(t, "2026-10-29T01:02:03.123456Z", canonicalMessageTime(value))
	}
	msg := Message{CreatedAt: "2026-10-29 01:02:03.123457+00", UpdatedAt: "2026-10-29 01:02:03.123456+00"}
	normalizeMessageTimes(&msg)
	require.Equal(t, msg.CreatedAt, msg.UpdatedAt)
	msg.IsEdited = true
	msg.UpdatedAt = "2026-10-29 01:02:04.123456+00"
	normalizeMessageTimes(&msg)
	require.Equal(t, "2026-10-29T01:02:04.123456Z", msg.UpdatedAt)
}
