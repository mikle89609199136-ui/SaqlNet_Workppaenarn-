package chat

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandler_ToggleReaction_ErrorScenarios(t *testing.T) {
	testCases := []struct {
		name           string
		emoji          string
		setupMocks     func(sqlmock.Sqlmock, string, string, string)
		expectedStatus int
		expectedCode   string
		expectedMsg    string
	}{
		{
			name:  "message not found → 404",
			emoji: "👍",
			setupMocks: func(mock sqlmock.Sqlmock, messageID, userID, _ string) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT m.chat_id::text FROM messages.messages m WHERE m.id = $1 AND m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = m.id AND hm.user_id = $2)`,
				)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
			},
			expectedStatus: http.StatusNotFound,
			expectedCode:   "not_found",
			expectedMsg:    "message not found",
		},
		{
			name:  "user not a member → 403",
			emoji: "👍",
			setupMocks: func(mock sqlmock.Sqlmock, messageID, userID, chatID string) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT m.chat_id::text FROM messages.messages m WHERE m.id = $1 AND m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = m.id AND hm.user_id = $2)`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectRollback()
			},
			expectedStatus: http.StatusForbidden,
			expectedCode:   "access_denied",
			expectedMsg:    "access denied",
		},
		{
			name:           "invalid emoji (empty) → 400",
			emoji:          "",
			setupMocks:     func(sqlmock.Sqlmock, string, string, string) {},
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "emoji required",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, service, _ := setupTest(t)
			defer db.Close()

			const (
				userID    = "550e8400-e29b-41d4-a716-446655440003"
				messageID = "550e8400-e29b-41d4-a716-446655440003"
				chatID    = "550e8400-e29b-41d4-a716-446655440001"
			)
			tc.setupMocks(mock, messageID, userID, chatID)

			body, err := json.Marshal(map[string]string{"emoji": tc.emoji})
			require.NoError(t, err)
			req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+messageID+"/reactions", strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")
			req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID, Username: "testuser"}))

			w := httptest.NewRecorder()
			NewHandler(service).Messages(w, req)

			assert.Equal(t, tc.expectedStatus, w.Code)
			var resp httpx.Error
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
			assert.Equal(t, tc.expectedCode, resp.Code)
			assert.Equal(t, tc.expectedMsg, resp.Message)
			assert.Equal(t, "test-request-id", resp.RequestID)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestHandler_ToggleReaction_TransactionErrorRollback(t *testing.T) {
	db, mock, service, _ := setupTest(t)
	defer db.Close()

	const (
		userID    = "550e8400-e29b-41d4-a716-446655440003"
		messageID = "550e8400-e29b-41d4-a716-446655440003"
		chatID    = "550e8400-e29b-41d4-a716-446655440001"
		emoji     = "👍"
	)

	body, err := json.Marshal(map[string]string{"emoji": emoji})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+messageID+"/reactions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", "test-request-id")
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID, Username: "testuser"}))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT m.chat_id::text FROM messages.messages m WHERE m.id = $1 AND m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM messages.hidden_messages hm WHERE hm.message_id = m.id AND hm.user_id = $2)`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnError(errors.New("database error"))
	mock.ExpectRollback()

	w := httptest.NewRecorder()
	NewHandler(service).Messages(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	var resp httpx.Error
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "internal_error", resp.Code)
	assert.Equal(t, "reaction failed", resp.Message)
	assert.Equal(t, "test-request-id", resp.RequestID)
	assert.NoError(t, mock.ExpectationsWereMet())
}
