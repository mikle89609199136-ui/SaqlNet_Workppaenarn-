package chat

import "testing"

func TestIsEncryptedMessagePayload(t *testing.T) {
	for _, tc := range []struct {
		content   string
		encrypted bool
	}{
		{`{"v":2,"e2e":true,"iv":"abc","data":"ciphertext"}`, true},
		{`{"e2e":true,"iv":"abc","data":"ciphertext"}`, true},
		{`{"e2e":true,"data":"ciphertext"}`, false},
		{`{"e2e":false,"iv":"abc","data":"ciphertext"}`, false},
		{`a & b <i>x</i>`, false},
	} {
		if got := isEncryptedMessagePayload(tc.content); got != tc.encrypted {
			t.Errorf("isEncryptedMessagePayload(%q) = %v", tc.content, got)
		}
	}
}
