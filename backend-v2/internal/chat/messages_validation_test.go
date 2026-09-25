package chat

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	messageValidationUserID    = "550e8400-e29b-41d4-a716-446655440001"
	messageValidationChatID    = "550e8400-e29b-41d4-a716-446655440002"
	messageValidationMessageID = "550e8400-e29b-41d4-a716-446655440003"
)

func messageValidationHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return NewHandler(NewService(db, nil, nil)), mock
}

func messageValidationRequest(method, target, body, pathKey, pathValue string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.SetPathValue(pathKey, pathValue)
	return req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: messageValidationUserID}))
}

func TestSendMessageRejectsInvalidPayloadWithoutDatabaseWrites(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "empty object defaults to empty text", body: `{}`},
		{name: "text without content", body: `{"type":"text"}`},
		{name: "text with empty content", body: `{"type":"text","content":""}`},
		{name: "text with whitespace content", body: `{"type":"text","content":"   "}`},
		{name: "unknown type", body: `{"type":"totally-unknown","content":"hello"}`},
		{name: "sticker with caption", body: `{"type":"sticker","content":"caption","mediaUrl":"/media/sticker"}`},
		{name: "sticker without media", body: `{"type":"sticker","content":""}`},
		{name: "image without media", body: `{"type":"image","content":""}`},
		{name: "audio without media", body: `{"type":"audio","content":""}`},
		{name: "video without media", body: `{"type":"video","content":""}`},
		{name: "voice without media", body: `{"type":"voice","content":""}`},
		{name: "gif without media", body: `{"type":"gif","content":""}`},
		{name: "file without media", body: `{"type":"file","content":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := messageValidationHandler(t)
			recorder := httptest.NewRecorder()
			req := messageValidationRequest(
				http.MethodPost,
				"/api/v2/messages/"+messageValidationChatID,
				tt.body,
				"chatId",
				messageValidationChatID,
			)

			handler.SendMessage(recorder, req)

			assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestSendMessageRejectsMalformedReplyToWithoutInsert(t *testing.T) {
	handler, mock := messageValidationHandler(t)
	mock.ExpectQuery(`SELECT cm\.role`).
		WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", false))

	recorder := httptest.NewRecorder()
	req := messageValidationRequest(
		http.MethodPost,
		"/api/v2/messages/"+messageValidationChatID,
		`{"type":"text","content":"reply","replyTo":"not-a-uuid"}`,
		"chatId",
		messageValidationChatID,
	)

	handler.SendMessage(recorder, req)

	assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessageRejectsUnavailableReplyWithoutInsert(t *testing.T) {
	tests := []struct {
		name string
	}{
		{name: "missing reply"},
		{name: "deleted reply"},
		{name: "reply from another chat"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := messageValidationHandler(t)
			mock.ExpectQuery(`SELECT cm\.role`).
				WithArgs(messageValidationChatID, messageValidationUserID).
				WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", false))
			mock.ExpectBegin()
			mock.ExpectQuery(`SELECT id::text`).
				WithArgs(messageValidationMessageID, messageValidationChatID).
				WillReturnError(sql.ErrNoRows)
			mock.ExpectRollback()

			recorder := httptest.NewRecorder()
			req := messageValidationRequest(
				http.MethodPost,
				"/api/v2/messages/"+messageValidationChatID,
				`{"type":"text","content":"reply","replyTo":"`+messageValidationMessageID+`"}`,
				"chatId",
				messageValidationChatID,
			)

			handler.SendMessage(recorder, req)

			assertErrorResponse(t, recorder, http.StatusNotFound, "reply_not_found")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestSendMessageValidateReply(t *testing.T) {
	handler, mock := messageValidationHandler(t)
	mock.ExpectQuery(`SELECT cm\.role`).
		WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery(`WITH inserted AS`).
		WithArgs(
			messageValidationChatID,
			messageValidationUserID,
			"some message",
			"text",
			sql.NullString{},
			[]byte("null"),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
			"content", "type", "reply_to", "metadata", "is_pinned", "is_edited",
			"created_at", "updated_at", "deleted_at",
		}).AddRow(
			messageValidationMessageID,
			messageValidationChatID,
			messageValidationUserID,
			"Alice",
			"",
			"some message",
			"text",
			nil,
			[]byte("null"),
			false,
			false,
			"2026-09-14T00:00:00Z",
			"2026-09-14T00:00:00Z",
			nil,
		))
	mock.ExpectCommit()

	recorder := httptest.NewRecorder()
	req := messageValidationRequest(
		http.MethodPost,
		"/api/v2/messages/"+messageValidationChatID,
		`{"type":"text","content":"some message","replyTo":""}`,
		"chatId",
		messageValidationChatID,
	)

	handler.SendMessage(recorder, req)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEditMessageRequiresContentFieldWithoutDatabaseWrites(t *testing.T) {
	handler, mock := messageValidationHandler(t)
	recorder := httptest.NewRecorder()
	req := messageValidationRequest(
		http.MethodPut,
		"/api/v2/messages/"+messageValidationMessageID,
		`{}`,
		"messageId",
		messageValidationMessageID,
	)

	handler.EditMessage(recorder, req)

	assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEditMessageRejectsInvalidContentForStoredTypeWithoutUpdate(t *testing.T) {
	tests := []struct {
		name      string
		msgType   string
		content   string
		wantError error
	}{
		{name: "empty text", msgType: "text", content: "", wantError: ErrInvalidInput},
		{name: "whitespace text", msgType: "text", content: "   ", wantError: ErrInvalidInput},
		{name: "sticker caption", msgType: "sticker", content: "caption", wantError: ErrStickerCannotBeEdited},
		{name: "empty sticker caption", msgType: "sticker", content: "", wantError: ErrStickerCannotBeEdited},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()

			mock.ExpectQuery(`SELECT m\.type`).
				WithArgs(messageValidationMessageID, messageValidationUserID).
				WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow(tt.msgType))

			_, err = NewService(db, nil, nil).EditMessage(
				t.Context(),
				messageValidationUserID,
				messageValidationMessageID,
				tt.content,
			)

			require.ErrorIs(t, err, tt.wantError)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestEditMessageAllowsEmptyCaptionForMedia(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectQuery(`SELECT m\.type`).
		WithArgs(messageValidationMessageID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("image"))
	mock.ExpectQuery(`WITH updated AS`).
		WithArgs("", messageValidationMessageID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
			"content", "type", "reply_to", "metadata", "is_pinned", "is_edited",
			"created_at", "updated_at", "deleted_at",
		}).AddRow(
			messageValidationMessageID,
			messageValidationChatID,
			messageValidationUserID,
			"Alice",
			"",
			"",
			"image",
			nil,
			[]byte(`{}`),
			false,
			true,
			"2026-09-13T00:00:00Z",
			"2026-09-13T00:01:00Z",
			nil,
		))

	message, err := NewService(db, nil, nil).EditMessage(
		t.Context(),
		messageValidationUserID,
		messageValidationMessageID,
		"",
	)

	require.NoError(t, err)
	require.Equal(t, "image", message.Type)
	require.Empty(t, message.Content)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEditMessageReturnsNotFoundWhenMessageIsNotEditable(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectQuery(`SELECT m\.type`).
		WithArgs(messageValidationMessageID, messageValidationUserID).
		WillReturnError(sql.ErrNoRows)

	_, err = NewService(db, nil, nil).EditMessage(
		t.Context(),
		messageValidationUserID,
		messageValidationMessageID,
		"updated",
	)

	require.ErrorIs(t, err, ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEditMessageHTTPReturnsNotFoundWhenMessageCannotBeEdited(t *testing.T) {
	tests := []struct {
		name                 string
		messageTypeIsVisible bool
	}{
		{name: "message does not exist"},
		{name: "message belongs to another author"},
		{name: "requester is not a chat member"},
		{name: "author is removed after type lookup", messageTypeIsVisible: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := messageValidationHandler(t)
			typeQuery := mock.ExpectQuery(
				`SELECT m\.type[\s\S]*JOIN chats\.members[\s\S]*cm\.user_id = \$2[\s\S]*m\.sender_id = \$2`,
			).WithArgs(messageValidationMessageID, messageValidationUserID)

			if tt.messageTypeIsVisible {
				typeQuery.WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("text"))
				mock.ExpectQuery(`WITH updated AS`).
					WithArgs("updated", messageValidationMessageID, messageValidationUserID).
					WillReturnError(sql.ErrNoRows)
			} else {
				typeQuery.WillReturnError(sql.ErrNoRows)
			}

			recorder := httptest.NewRecorder()
			req := messageValidationRequest(
				http.MethodPut,
				"/api/v2/messages/"+messageValidationMessageID,
				`{"content":"updated"}`,
				"messageId",
				messageValidationMessageID,
			)

			handler.EditMessage(recorder, req)

			assertErrorResponse(t, recorder, http.StatusNotFound, "message_not_found")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
