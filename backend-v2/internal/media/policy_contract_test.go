package media

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPublishedMediaPolicy(t *testing.T) {
	data, err := os.ReadFile("../../contracts/openapi/media-policy.json")
	require.NoError(t, err)
	var policy struct {
		MaxFileSizeBytes        int64    `json:"maxFileSizeBytes"`
		EncryptionOverheadBytes int64    `json:"encryptionOverheadBytes"`
		MaxVoiceCiphertextBytes int64    `json:"maxVoiceCiphertextBytes"`
		PlainMimeTypes          []string `json:"plainMimeTypes"`
	}
	require.NoError(t, json.Unmarshal(data, &policy))
	require.EqualValues(t, 100<<20, policy.MaxFileSizeBytes)
	require.EqualValues(t, mediaEncryptionOverheadBytes, policy.EncryptionOverheadBytes)
	require.EqualValues(t, maxVoiceBytes, policy.MaxVoiceCiphertextBytes)
	require.Len(t, policy.PlainMimeTypes, len(allowedTypes))
	publishedTypes := make(map[string]bool, len(policy.PlainMimeTypes))
	for _, mediaType := range policy.PlainMimeTypes {
		publishedTypes[mediaType] = true
	}
	require.Equal(t, allowedTypes, publishedTypes)
}
