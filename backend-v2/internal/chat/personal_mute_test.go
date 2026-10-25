package chat

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPersonalMuteRejectsInvalidBeforeDatabase(t *testing.T) {
	h := NewHandler(NewService(nil, nil, nil))
	for _, tc := range []struct {
		method, body string
		status       int
	}{
		{"POST", `null`, 400}, {"POST", `[]`, 400}, {"POST", `true`, 400},
		{"POST", `{"mutedUntil":123}`, 400}, {"POST", `{"mutedUntil":false}`, 400},
		{"POST", `{"mutedUntil":""}`, 400}, {"POST", `{"mutedUntil":"tomorrow"}`, 400},
		{"POST", `{"mutedUntil":"2000-01-01T00:00:00Z"}`, 400},
		{"POST", `{"mutedUntil":"99999-01-01T00:00:00Z"}`, 400},
		{"POST", `{"mutedUntil":"2026-01-01"}`, 400},
		{"POST", `{"MutedUntil":null}`, 400}, {"POST", `{"userId":"other"}`, 400},
		{"POST", `{} {}`, 400}, {"POST", `{`, 400}, {"POST", ``, 400},
		{"GET", ``, 405}, {"PUT", `{}`, 405},
	} {
		t.Run(tc.method+"/"+tc.body, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.Chat(w, newAuthedRequest(tc.method, "/api/v2/chats/"+handlerChatID+"/mute", []byte(tc.body), handlerActorID))
			require.Equal(t, tc.status, w.Code, w.Body.String())
		})
	}
}
