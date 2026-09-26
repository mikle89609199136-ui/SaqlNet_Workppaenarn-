package chat

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// Отправка пачкой (#808): одно сообщение и несколько идут одним путём.

func batchHandler(t *testing.T) (*Handler, sqlmock.Sqlmock, *recordingRealtime) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	realtime := &recordingRealtime{}
	return NewHandler(NewService(db, realtime, nil)), mock, realtime
}

func sendBatch(handler *Handler, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	handler.SendMessage(recorder, messageValidationRequest(
		http.MethodPost,
		"/api/v2/messages/"+messageValidationChatID,
		body,
		"chatId",
		messageValidationChatID,
	))
	return recorder
}

func textItem(content string) string {
	return `{"type":"text","content":"` + content + `"}`
}

func expectSendAllowed(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`SELECT cm\.role`).
		WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted", "blocked_by_peer"}).AddRow("member", false, false))
}

func expectInsert(mock sqlmock.Sqlmock, content string, index int) {
	mock.ExpectQuery(`WITH inserted AS`).
		WithArgs(messageValidationChatID, messageValidationUserID, content, "text", sql.NullString{}, []byte("null"), index).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
			"content", "type", "reply_to", "metadata", "is_pinned", "is_edited",
			"created_at", "updated_at", "deleted_at",
		}).AddRow(
			fmt.Sprintf("550e8400-e29b-41d4-a716-4466554401%02d", index), messageValidationChatID, messageValidationUserID, "Alice", "",
			content, "text", nil, []byte("null"), false, false,
			"2026-09-26T00:00:00Z", "2026-09-26T00:00:00Z", nil,
		))
}

func errorIndex(t *testing.T, recorder *httptest.ResponseRecorder) int {
	t.Helper()
	var body struct {
		Details struct {
			Index *int `json:"index"`
		} `json:"details"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.NotNil(t, body.Details.Index, "ошибка сообщения из пачки должна называть его номер: %s", recorder.Body.String())
	return *body.Details.Index
}

func TestSendRejectsEmptyAndOversizedBatchWithoutDatabase(t *testing.T) {
	items := make([]string, maxMessagesPerSend+1)
	for i := range items {
		items[i] = textItem("m")
	}

	tests := []struct {
		name string
		body string
	}{
		{name: "без поля messages", body: `{}`},
		{name: "пустая пачка", body: `{"messages":[]}`},
		{name: "одиночное тело по-старому", body: textItem("hello")},
		{name: "больше предела", body: sendBody(items...)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock, realtime := batchHandler(t)

			recorder := sendBatch(handler, tt.body)

			assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
			require.Empty(t, realtime.broadcasts)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestSendAcceptsBatchAtTheLimit(t *testing.T) {
	handler, mock, realtime := batchHandler(t)
	items := make([]string, maxMessagesPerSend)
	expectSendAllowed(mock)
	mock.ExpectBegin()
	for i := range items {
		items[i] = textItem(fmt.Sprintf("m%d", i))
		expectInsert(mock, fmt.Sprintf("m%d", i), i)
	}
	mock.ExpectCommit()

	recorder := sendBatch(handler, sendBody(items...))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Len(t, realtime.broadcasts, maxMessagesPerSend)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendNamesTheInvalidMessageAndWritesNothing(t *testing.T) {
	handler, mock, realtime := batchHandler(t)

	recorder := sendBatch(handler, sendBody(textItem("первое"), textItem("второе"), `{"type":"text","content":"  "}`))

	assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
	require.Equal(t, 2, errorIndex(t, recorder))
	require.Empty(t, realtime.broadcasts)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendWritesBatchInOrderInOneTransaction(t *testing.T) {
	handler, mock, realtime := batchHandler(t)
	expectSendAllowed(mock)
	mock.ExpectBegin()
	// Номер сообщения уходит в запрос: из него складывается время
	// создания, иначе у всей пачки оно одно и лента её перемешает.
	expectInsert(mock, "комментарий", 0)
	expectInsert(mock, "первое", 1)
	expectInsert(mock, "второе", 2)
	mock.ExpectCommit()

	recorder := sendBatch(handler, sendBody(textItem("комментарий"), textItem("первое"), textItem("второе")))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var response struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Messages, 3)
	require.Equal(t, "комментарий", response.Messages[0].Content)
	require.Equal(t, "второе", response.Messages[2].Content)

	// По событию на сообщение, в том же порядке; себе не шлём.
	require.Len(t, realtime.broadcasts, 3)
	for i, want := range []string{"комментарий", "первое", "второе"} {
		require.Equal(t, messageValidationUserID, realtime.broadcasts[i].exclude)
		require.True(t, strings.Contains(string(realtime.broadcasts[i].payload), want), "событие %d: %s", i, realtime.broadcasts[i].payload)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendRollsBackWholeBatchWhenReplyIsUnavailable(t *testing.T) {
	handler, mock, realtime := batchHandler(t)
	expectSendAllowed(mock)
	mock.ExpectBegin()
	expectInsert(mock, "первое", 0)
	mock.ExpectQuery(`SELECT id::text`).
		WithArgs(messageValidationMessageID, messageValidationChatID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	recorder := sendBatch(handler, sendBody(
		textItem("первое"),
		`{"type":"text","content":"ответ","replyTo":"`+messageValidationMessageID+`"}`,
	))

	assertErrorResponse(t, recorder, http.StatusNotFound, "reply_not_found")
	require.Equal(t, 1, errorIndex(t, recorder))
	require.Empty(t, realtime.broadcasts, "первое сообщение не должно уйти: пачка — всё или ничего")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendRejectsMalformedReplyByIndexBeforeTransaction(t *testing.T) {
	handler, mock, _ := batchHandler(t)
	expectSendAllowed(mock)

	recorder := sendBatch(handler, sendBody(
		textItem("первое"),
		`{"type":"text","content":"ответ","replyTo":"not-a-uuid"}`,
	))

	assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
	require.Equal(t, 1, errorIndex(t, recorder))
	require.NoError(t, mock.ExpectationsWereMet())
}
