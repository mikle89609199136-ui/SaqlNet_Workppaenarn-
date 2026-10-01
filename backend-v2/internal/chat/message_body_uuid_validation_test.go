package chat

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReadMessages_InvalidChatIDReturns400WithoutSQL(t *testing.T) {
	handler, mock := newTestHandler(t)
	req := newAuthedRequest(
		http.MethodPost,
		"/api/v2/messages/read",
		[]byte(`{"chatId":"not-a-uuid","messageIds":[]}`),
		handlerActorID,
	)
	recorder := httptest.NewRecorder()

	handler.MarkMessagesRead(recorder, req)

	assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

// Отмечаются переданные сообщения (#506): пустой список, больше 500 ID и
// не-UUID — отказ до базы, без «отметить весь чат».
func TestReadMessages_InvalidMessageIDsReturn400WithoutSQL(t *testing.T) {
	const chatID = "11111111-1111-4111-8111-111111111111"
	many := make([]string, MaxMarkReadIDs+1)
	for i := range many {
		many[i] = `"` + chatID + `"`
	}
	bodies := map[string]string{
		"пустой список": `{"chatId":"` + chatID + `","messageIds":[]}`,
		"без списка":    `{"chatId":"` + chatID + `"}`,
		"не UUID":       `{"chatId":"` + chatID + `","messageIds":["not-a-uuid"]}`,
		"больше 500 ID": `{"chatId":"` + chatID + `","messageIds":[` + strings.Join(many, ",") + `]}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			handler, mock := newTestHandler(t)
			req := newAuthedRequest(http.MethodPost, "/api/v2/messages/read", []byte(body), handlerActorID)
			recorder := httptest.NewRecorder()

			handler.MarkMessagesRead(recorder, req)

			assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
