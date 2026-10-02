package chat

import (
	"encoding/json"
)

func isEncryptedMessagePayload(content string) bool {
	var payload struct {
		E2E  bool   `json:"e2e"`
		IV   string `json:"iv"`
		Data string `json:"data"`
	}
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return false
	}
	return payload.E2E && payload.IV != "" && payload.Data != ""
}
