package user

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConflictingOrInvalidSoundAliasesRejectBeforeAnySQL(t *testing.T) {
	h := NewHandler(NewService(nil), nil)
	for path, bodies := range map[string][]string{
		"sounds": {`{"messagesSound":true,"notificationsSound":false}`},
		"all-settings": {
			`{"soundSettings":{"messagesSound":true,"notificationsSound":false},"settings":{"theme":"light"}}`,
			`{"settings":{"sounds":true},"soundSettings":{"messagesSound":null}}`,
			`{"settings":{"sounds":true},"soundSettings":{"notificationsSound":"false"}}`,
			`{"settings":{"callSounds":false},"soundSettings":{"callsSound":0}}`,
		},
	} {
		for _, body := range bodies {
			w := settingsRequest(t, h, path, body)
			require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), `"code":"validation_failed"`)
		}
	}
}
