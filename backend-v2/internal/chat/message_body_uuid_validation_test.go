package chat

import (
	"net/http"
	"net/http/httptest"
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
