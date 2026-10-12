package chat

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestHandlerNotificationSettings(t *testing.T) {
	for _, tc := range []struct {
		name, method, body, chatID string
		write                      bool
		affected                   int64
		dbErr                      error
		status                     int
	}{
		{name: "hide", method: "PUT", body: `{"hideNotificationPreview":true}`, write: true, affected: 1, status: 200},
		{name: "show", method: "PUT", body: `{"hideNotificationPreview":false}`, write: true, affected: 1, status: 200},
		{name: "not a member", method: "PUT", body: `{"hideNotificationPreview":true}`, write: true, status: 403},
		{name: "database failure", method: "PUT", body: `{"hideNotificationPreview":true}`, write: true, dbErr: errors.New("db failed"), status: 500},
		{name: "missing", method: "PUT", body: `{}`, status: 400},
		{name: "null", method: "PUT", body: `{"hideNotificationPreview":null}`, status: 400},
		{name: "wrong type", method: "PUT", body: `{"hideNotificationPreview":"true"}`, status: 400},
		{name: "invalid JSON", method: "PUT", body: `{`, status: 400},
		{name: "invalid UUID", method: "PUT", chatID: "bad", body: `{"hideNotificationPreview":true}`, status: 400},
		{name: "wrong method", method: "POST", body: `{"hideNotificationPreview":true}`, status: 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler, mock := newTestHandler(t)
			chatID := tc.chatID
			if chatID == "" {
				chatID = handlerChatID
			}
			if tc.write {
				expectation := mock.ExpectExec(setNotificationPreviewQuery).
					WithArgs(handlerActorID, chatID, tc.name != "show")
				if tc.dbErr != nil {
					expectation.WillReturnError(tc.dbErr)
				} else {
					expectation.WillReturnResult(sqlmock.NewResult(0, tc.affected))
				}
			}
			recorder := httptest.NewRecorder()
			handler.Chat(recorder, newAuthedRequest(tc.method, "/api/v2/chats/"+chatID+"/notification-settings", []byte(tc.body), handlerActorID))
			require.Equal(t, tc.status, recorder.Code, recorder.Body.String())
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestNotificationSettingsRejectInvalidUser(t *testing.T) {
	handler, mock := newTestHandler(t)
	recorder := httptest.NewRecorder()
	handler.Chat(recorder, newAuthedRequest(http.MethodPut, "/api/v2/chats/"+handlerChatID+"/notification-settings", []byte(`{"hideNotificationPreview":true}`), "invalid"))
	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}
