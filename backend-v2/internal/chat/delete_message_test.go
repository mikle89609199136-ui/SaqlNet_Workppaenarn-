package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	deleteMessageUserID = "00000000-0000-0000-0000-000000000001"
	deleteMessageChatID = "00000000-0000-0000-0000-000000000002"
	previousMessageID   = "00000000-0000-0000-0000-000000000003"
	deletedMessageID    = "00000000-0000-0000-0000-000000000004"
	lastMessageID       = "00000000-0000-0000-0000-000000000005"
)

var deleteMessageCreatedAt = time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

func deleteMessageRows(id, content, createdAt string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "type",
		"reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at", "reactions",
	}).AddRow(id, deleteMessageChatID, deleteMessageUserID, "Alice", "", content, "text", nil,
		[]byte(`{}`), false, false, createdAt, createdAt, nil, []byte(`[]`))
}

func emptyDeleteMessageRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "chat_id", "sender_id"})
}

func expectDeleteUpdate(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`UPDATE messages\.messages AS m`).WithArgs(deletedMessageID, deleteMessageUserID).
		WillReturnRows(sqlmock.NewRows([]string{"chat_id", "created_at"}).AddRow(deleteMessageChatID, deleteMessageCreatedAt))
}

func expectMessageAfterDelete(mock sqlmock.Sqlmock, before any, rows *sqlmock.Rows) {
	mock.ExpectQuery(`AND \(\$2::timestamptz IS NULL OR[\s\S]*ORDER BY m\.created_at DESC, m\.id DESC`).
		WithArgs(deleteMessageChatID, before, deletedMessageID, deleteMessageUserID).WillReturnRows(rows)
}

func TestDeleteMessage_ReturnsChatLastMessageAndBroadcastsPreviousMessage(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &recordingRealtime{}
	mock.ExpectBegin()
	expectDeleteUpdate(mock)
	expectMessageAfterDelete(mock, deleteMessageCreatedAt, deleteMessageRows(previousMessageID, "Previous", "2026-08-20T11:00:00Z"))
	expectMessageAfterDelete(mock, nil, deleteMessageRows(lastMessageID, "Latest", "2026-08-20T13:00:00Z"))
	mock.ExpectCommit()

	lastMessage, err := NewService(db, ws).DeleteMessage(context.Background(), deleteMessageUserID, deletedMessageID)
	require.NoError(t, err)
	require.NotNil(t, lastMessage)
	require.Equal(t, lastMessageID, lastMessage.ID)
	require.Equal(t, "Latest", lastMessage.Content)
	require.Empty(t, lastMessage.Reactions)
	require.Len(t, ws.broadcasts, 1)
	var event struct {
		Type            string   `json:"type"`
		ChatID          string   `json:"chatId"`
		MessageID       string   `json:"messageId"`
		PreviousMessage *Message `json:"previousMessage"`
	}
	require.NoError(t, json.Unmarshal(ws.broadcasts[0].payload, &event))
	require.Equal(t, "message_deleted", event.Type)
	require.Equal(t, previousMessageID, event.PreviousMessage.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteMessage_ReturnsNullWhenChatHasNoMessages(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &recordingRealtime{}
	mock.ExpectBegin()
	expectDeleteUpdate(mock)
	expectMessageAfterDelete(mock, deleteMessageCreatedAt, emptyDeleteMessageRows())
	expectMessageAfterDelete(mock, nil, emptyDeleteMessageRows())
	mock.ExpectCommit()
	lastMessage, err := NewService(db, ws).DeleteMessage(context.Background(), deleteMessageUserID, deletedMessageID)
	require.NoError(t, err)
	require.Nil(t, lastMessage)
	var event map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(ws.broadcasts[0].payload, &event))
	require.JSONEq(t, `null`, string(event["previousMessage"]))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteMessage_HTTPResponseContainsLastMessage(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectBegin()
	expectDeleteUpdate(mock)
	expectMessageAfterDelete(mock, deleteMessageCreatedAt, deleteMessageRows(previousMessageID, "Previous", "2026-08-20T11:00:00Z"))
	expectMessageAfterDelete(mock, nil, deleteMessageRows(lastMessageID, "Latest", "2026-08-20T13:00:00Z"))
	mock.ExpectCommit()
	recorder := deleteMessageRequest(NewService(db, nil), deletedMessageID)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success     bool     `json:"success"`
		LastMessage *Message `json:"lastMessage"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Equal(t, lastMessageID, response.LastMessage.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteMessage_HTTPResponseContainsNullLastMessage(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectBegin()
	expectDeleteUpdate(mock)
	expectMessageAfterDelete(mock, deleteMessageCreatedAt, emptyDeleteMessageRows())
	expectMessageAfterDelete(mock, nil, emptyDeleteMessageRows())
	mock.ExpectCommit()
	recorder := deleteMessageRequest(NewService(db, nil), deletedMessageID)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.JSONEq(t, `null`, string(response["lastMessage"]))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteMessage_InvalidUUIDReturns400WithoutSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	_, err = NewService(db, nil).DeleteMessage(context.Background(), deleteMessageUserID, "not-a-uuid")
	require.ErrorIs(t, err, ErrInvalidInput)
	require.NoError(t, mock.ExpectationsWereMet())
	require.Equal(t, http.StatusBadRequest, deleteMessageRequest(NewService(db, nil), "not-a-uuid").Code)
}

func TestDeleteMessage_NotFoundRollsBackWithoutBroadcast(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &recordingRealtime{}
	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE messages\.messages AS m`).WithArgs(deletedMessageID, deleteMessageUserID).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	_, err = NewService(db, ws).DeleteMessage(context.Background(), deleteMessageUserID, deletedMessageID)
	require.ErrorIs(t, err, ErrNotFound)
	require.Empty(t, ws.broadcasts)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteMessage_LastMessageLookupErrorRollsBackWithoutBroadcast(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &recordingRealtime{}
	mock.ExpectBegin()
	expectDeleteUpdate(mock)
	expectMessageAfterDelete(mock, deleteMessageCreatedAt, emptyDeleteMessageRows())
	mock.ExpectQuery(`AND \(\$2::timestamptz IS NULL OR`).
		WithArgs(deleteMessageChatID, nil, deletedMessageID, deleteMessageUserID).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()
	_, err = NewService(db, ws).DeleteMessage(context.Background(), deleteMessageUserID, deletedMessageID)
	require.ErrorIs(t, err, sql.ErrConnDone)
	require.Empty(t, ws.broadcasts)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteMessage_CommitErrorDoesNotBroadcast(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &recordingRealtime{}
	mock.ExpectBegin()
	expectDeleteUpdate(mock)
	expectMessageAfterDelete(mock, deleteMessageCreatedAt, emptyDeleteMessageRows())
	expectMessageAfterDelete(mock, nil, emptyDeleteMessageRows())
	mock.ExpectCommit().WillReturnError(sql.ErrTxDone)
	_, err = NewService(db, ws).DeleteMessage(context.Background(), deleteMessageUserID, deletedMessageID)
	require.ErrorIs(t, err, sql.ErrTxDone)
	require.Empty(t, ws.broadcasts)
	require.NoError(t, mock.ExpectationsWereMet())
}

func deleteMessageRequest(svc *Service, messageID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodDelete, "/api/v2/messages/"+messageID, nil)
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: deleteMessageUserID}))
	recorder := httptest.NewRecorder()
	NewHandler(svc).Messages(recorder, req)
	return recorder
}
