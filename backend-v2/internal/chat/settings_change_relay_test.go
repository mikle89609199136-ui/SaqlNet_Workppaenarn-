package chat

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestSettingsRelayTargetsOnlyOwnerAndDropsExtraFields(t *testing.T) {
	b := &profileChangeBroadcaster{}
	require.NoError(t, broadcastSettingsChange(b, `{"userId":"73000000-0000-4000-8000-000000000001","version":1,"settings":{"privacy":"secret"}}`))
	require.Equal(t, []string{"73000000-0000-4000-8000-000000000001"}, b.recipients)
	var got map[string]any
	require.NoError(t, json.Unmarshal(b.payload, &got))
	require.Equal(t, map[string]any{"type": "settings_updated", "payload": map[string]any{"userId": b.recipients[0], "version": float64(1)}}, got)
}
func TestSettingsRelayRejectsInvalidPayload(t *testing.T) {
	for _, raw := range []string{`{`, `{}`, `{"userId":"not-an-owner","version":1}`, `{"userId":"73000000-0000-4000-8000-000000000001","version":2}`, `{"userId":"00000000-0000-0000-0000-000000000000","version":1}`} {
		b := &profileChangeBroadcaster{}
		require.Error(t, broadcastSettingsChange(b, raw))
		require.Empty(t, b.recipients)
	}
}
