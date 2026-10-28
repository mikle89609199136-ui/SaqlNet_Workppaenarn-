package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	listMessagesUserID = "550e8400-e29b-41d4-a716-446655440001"
	listMessagesChatID = "550e8400-e29b-41d4-a716-446655440002"
)

const (
	selectIsMemberSQL     = "SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)"
	selectChatExistsSQL   = "SELECT EXISTS(SELECT 1 FROM chats.chats WHERE id = $1)"
	selectListMessagesSQL = `
	SELECT *
FROM (
SELECT m.id::text, m.chat_id::text, m.sender_id::text,
      COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
      m.content, m.entities, m.type, m.reply_to::text, m.metadata,
      (p.message_id IS NOT NULL), m.updated_at > m.created_at,
      m.created_at::text, m.updated_at::text, m.deleted_at::text, EXISTS(SELECT 1 FROM messages.personal_pins pp WHERE pp.message_id = m.id AND pp.user_id = $4)
FROM messages.messages m
LEFT JOIN auth.users au ON au.id = m.sender_id
LEFT JOIN users.profiles up ON up.user_id = m.sender_id
LEFT JOIN messages.pins p ON p.message_id = m.id
WHERE m.chat_id = $1 AND m.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = m.id AND hm.user_id = $4)
ORDER BY m.created_at DESC
LIMIT $2 OFFSET $3
) recent_messages
ORDER BY created_at ASC
	`
)

// TestListMessages_ChatNotFound проверяет, что при попытке получить сообщения
// несуществующего чата сервис возвращает ошибку ErrNotFound.
func TestListMessages_ChatNotFound(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	expectMembershipAndChat(mock, false, false)

	svc := NewService(db, nil, nil)
	_, err = svc.ListMessages(context.Background(), listMessagesUserID, listMessagesChatID, 50, 0)
	require.ErrorIs(t, err, ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestListMessages_NotMember проверяет, что при попытке получить сообщения
// существующего чата пользователем, не состоящим в нём, сервис возвращает ErrForbidden.
func TestListMessages_NotMember(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	expectMembershipAndChat(mock, false, true)

	svc := NewService(db, nil, nil)
	_, err = svc.ListMessages(context.Background(), listMessagesUserID, listMessagesChatID, 50, 0)
	require.ErrorIs(t, err, ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestListMessages_Success проверяет, что участник чата успешно получает сообщения,
// а дополнительный запрос проверки существования чата на happy-path не выполняется.
func TestListMessages_Success(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	expectMembershipAndChat(mock, true, false)

	mock.ExpectQuery(selectListMessagesSQL).
		WithArgs(listMessagesChatID, 50, 0, listMessagesUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "entities", "type", "reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at"}))
	svc := NewService(db, nil, nil)
	_, err = svc.ListMessages(context.Background(), listMessagesUserID, listMessagesChatID, 50, 0)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestHandler_ListMessages_ErrorMapping проверяет преобразование доменных ошибок
// сервиса в корректные HTTP-статусы и коды JSON в Handler.ListMessages.
func TestHandler_ListMessages_ErrorMapping(t *testing.T) {
	tests := []struct {
		name       string
		mockSetup  func(sqlmock.Sqlmock)
		wantStatus int
		wantCode   string
	}{
		{
			name: "chat not found",
			mockSetup: func(mock sqlmock.Sqlmock) {
				expectMembershipAndChat(mock, false, false)
			},
			wantStatus: http.StatusNotFound,
			wantCode:   "chat_not_found",
		},
		{
			name: "access denied",
			mockSetup: func(mock sqlmock.Sqlmock) {
				expectMembershipAndChat(mock, false, true)
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "access_denied",
		},
		{
			name: "internal error",
			mockSetup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(selectIsMemberSQL).
					WithArgs(listMessagesUserID, listMessagesChatID).
					WillReturnError(errors.New("db error"))
			},
			wantStatus: http.StatusInternalServerError,
			wantCode:   "internal_error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := newTestHandler(t)
			tt.mockSetup(mock)
			req := newAuthedRequest(http.MethodGet, "/api/v2/messages/"+listMessagesChatID, nil, listMessagesUserID)
			req.SetPathValue("chatId", listMessagesChatID)
			rr := httptest.NewRecorder()
			handler.ListMessages(rr, req)
			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestHandler_ListMessages_PaginationValidation проверяет, что при невалидных limit или offset
// эндпоинт ListMessages возвращает 400 validation_failed без обращения к базе данных.
func TestHandler_ListMessages_PaginationValidation(t *testing.T) {
	tests := []struct {
		name        string
		query       string
		wantMessage string
	}{
		{name: "limit below minimum", query: "?limit=0", wantMessage: "invalid limit"},
		{name: "negative limit", query: "?limit=-1", wantMessage: "invalid limit"},
		{name: "limit above maximum", query: "?limit=101", wantMessage: "invalid limit"},
		{name: "non-numeric limit", query: "?limit=abc", wantMessage: "invalid limit"},
		{name: "empty limit param", query: "?limit=", wantMessage: "invalid limit"},
		{name: "negative offset", query: "?offset=-1", wantMessage: "invalid offset"},
		{name: "non-numeric offset", query: "?offset=xyz", wantMessage: "invalid offset"},
		{name: "empty offset param", query: "?offset=", wantMessage: "invalid offset"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := newTestHandler(t)
			req := newAuthedRequest(http.MethodGet, "/api/v2/messages/"+listMessagesChatID+tt.query, nil, listMessagesUserID)
			req.SetPathValue("chatId", listMessagesChatID)
			rr := httptest.NewRecorder()
			handler.ListMessages(rr, req)
			assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
			var errResp struct {
				Message string `json:"message"`
			}
			require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &errResp))
			assert.Equal(t, tt.wantMessage, errResp.Message)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestListMessages_EmptyChat проверяет, что при отсутствии сообщений в чате
// эндпоинт возвращает пустой JSON-массив {"messages": []}, а не {"messages": null}.
func TestListMessages_EmptyChat(t *testing.T) {
	handler, mock := newTestHandler(t)
	expectMembershipAndChat(mock, true, false)
	mock.ExpectQuery(selectListMessagesSQL).WithArgs(listMessagesChatID, 50, 0, listMessagesUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "entities", "type", "reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at"}))
	req := newAuthedRequest(http.MethodGet, "/api/v2/messages/"+listMessagesChatID, nil, listMessagesUserID)
	req.SetPathValue("chatId", listMessagesChatID)
	rr := httptest.NewRecorder()
	handler.ListMessages(rr, req)
	require.Equal(t, http.StatusOK, rr.Code)
	assert.JSONEq(t, `{"messages":[]}`, rr.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

// expectMembershipAndChat задаёт мок-ожидания проверки членства и (если не участник) существования чата.
func expectMembershipAndChat(mock sqlmock.Sqlmock, isMember, chatExists bool) {
	mock.ExpectQuery(selectIsMemberSQL).
		WithArgs(listMessagesUserID, listMessagesChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(isMember))
	if !isMember {
		mock.ExpectQuery(selectChatExistsSQL).
			WithArgs(listMessagesChatID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(chatExists))
	}
}
