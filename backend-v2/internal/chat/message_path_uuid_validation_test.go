package chat

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMessageHandlers_InvalidPathUUIDReturns400WithoutSQL(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		path    string
		pathKey string
		handler func(*Handler, http.ResponseWriter, *http.Request)
	}{
		{
			name:    "list messages invalid chatId",
			method:  http.MethodGet,
			path:    "/api/v2/messages/not-a-uuid",
			pathKey: "chatId",
			handler: (*Handler).ListMessages,
		},
		{
			name:    "send message invalid chatId",
			method:  http.MethodPost,
			path:    "/api/v2/messages/not-a-uuid",
			pathKey: "chatId",
			handler: (*Handler).SendMessage,
		},
		{
			name:    "edit message invalid messageId",
			method:  http.MethodPut,
			path:    "/api/v2/messages/not-a-uuid",
			pathKey: "messageId",
			handler: (*Handler).EditMessage,
		},
		{
			name:    "toggle reaction invalid messageId",
			method:  http.MethodPost,
			path:    "/api/v2/messages/not-a-uuid/reactions",
			handler: (*Handler).Messages,
		},
		{
			name:    "add favorite invalid messageId",
			method:  http.MethodPost,
			path:    "/api/v2/messages/not-a-uuid/favorite",
			handler: (*Handler).Messages,
		},
		{
			name:    "remove favorite invalid messageId",
			method:  http.MethodDelete,
			path:    "/api/v2/messages/not-a-uuid/favorite",
			handler: (*Handler).Messages,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, mock := newTestHandler(t)
			req := newAuthedRequest(test.method, test.path, nil, handlerActorID)
			if test.pathKey != "" {
				req.SetPathValue(test.pathKey, "not-a-uuid")
			}
			recorder := httptest.NewRecorder()

			test.handler(handler, recorder, req)

			assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
