package chat

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// reactionAuthorsMessageID is the UUID of the message targeted by the
// reaction-author endpoint. It lives here because no other handler test uses
// it, keeping the shared handler* constants untouched.
const reactionAuthorsMessageID = "550e8400-e29b-41d4-a716-446655440004"

// SQL patterns for ListReactionAuthors. Each query has a distinctive leading
// SELECT clause so that a single regexp is enough to tell them apart.
const (
	raAccessQueryPattern = `SELECT m\.chat_id::text`
	raPageQueryPattern   = `SELECT r\.user_id::text`
)

// Column sets returned to the service by sqlmock. Their names are cosmetic —
// sqlmock matches by position — but they document the shape of each result.
var (
	raAccessColumns = []string{"chat_id", "is_member", "total"}
	raPageColumns   = []string{
		"user_id", "username", "first_name", "last_name", "avatar_url",
		"created_at", "privacy_settings", "owner_blocks_viewer", "owner_exceptions",
	}
)

// TestHandler_ListReactionAuthors covers the HTTP contract of
// GET /api/v2/messages/{messageId}/reactions/users: request validation that
// must short-circuit before the database is touched, sentinel-error mapping,
// and the shape of a successful response.
//
// Uses the regexp-based sqlmock matcher (newTestHandlerQueryMatcher) because
// the access and page queries share a leading SELECT prefix; the equal matcher
// would require the exact literal SQL, which is intentionally not duplicated
// here.
//
// Since ListReactionAuthors now reads total and the page inside a single
// REPEATABLE READ transaction, every case that reaches the service must
// declare Begin and either Commit (success) or Rollback (early return). Cases
// that fail validation before the service is called expect no database
// traffic at all.
func TestHandler_ListReactionAuthors(t *testing.T) {
	tests := []struct {
		name          string
		method        string
		messageID     string
		rawQuery      string // without a leading '?'
		setupMock     func(sqlmock.Sqlmock)
		wantStatus    int
		wantErrorCode string
		checkBody     func(t *testing.T, body []byte)
	}{
		{
			name:          "method_not_allowed_405",
			method:        http.MethodPost,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusMethodNotAllowed,
			wantErrorCode: "method_not_allowed",
		},
		{
			// Validation runs before the service, so the mock expects nothing.
			name:          "malformed_message_id_400",
			method:        http.MethodGet,
			messageID:     "not-a-uuid",
			rawQuery:      "emoji=%F0%9F%91%8D",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			// The emoji parameter is mandatory for this endpoint: without it,
			// there is no way to know which author list the caller wants.
			name:          "missing_emoji_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "empty_emoji_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			// Duplicate parameters make the contract ambiguous, so they are
			// rejected even when both values are identical.
			name:          "duplicated_same_emoji_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&emoji=%F0%9F%91%8D",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "duplicated_different_emoji_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&emoji=%E2%9D%A4",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "limit_zero_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&limit=0",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "limit_above_max_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&limit=101",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "limit_not_a_number_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&limit=abc",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "negative_limit_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&limit=-1",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			// Cursor decoding happens in the service, before BeginTx, so a
			// malformed cursor produces no database traffic.
			name:          "malformed_cursor_400",
			method:        http.MethodGet,
			messageID:     reactionAuthorsMessageID,
			rawQuery:      "emoji=%F0%9F%91%8D&cursor=!!!not-base64!!!",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			// An empty result set from the access query means the message does
			// not exist or is soft-deleted; both map to 404. The transaction is
			// opened and then rolled back on the early return.
			name:      "message_not_found_404",
			method:    http.MethodGet,
			messageID: reactionAuthorsMessageID,
			rawQuery:  "emoji=%F0%9F%91%8D",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(raAccessQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍").
					WillReturnRows(sqlmock.NewRows(raAccessColumns))
				mock.ExpectRollback()
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "not_found",
		},
		{
			// is_member = false signals a caller who is not (or is no longer)
			// a member of the chat. The transaction is rolled back on the
			// early return.
			name:      "not_a_member_403",
			method:    http.MethodGet,
			messageID: reactionAuthorsMessageID,
			rawQuery:  "emoji=%F0%9F%91%8D",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(raAccessQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍").
					WillReturnRows(sqlmock.NewRows(raAccessColumns).
						AddRow(handlerChatID, false, 3))
				mock.ExpectRollback()
			},
			wantStatus:    http.StatusForbidden,
			wantErrorCode: "access_denied",
		},
		{
			// sql.ErrConnDone is the sentinel other service tests already use
			// for "database unreachable"; reusing it here keeps the mock error
			// vocabulary of the package consistent. The transaction is rolled
			// back on the early return.
			name:      "db_error_500",
			method:    http.MethodGet,
			messageID: reactionAuthorsMessageID,
			rawQuery:  "emoji=%F0%9F%91%8D",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(raAccessQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍").
					WillReturnError(sql.ErrConnDone)
				mock.ExpectRollback()
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "internal_error",
		},
		{
			// The handler must emit an empty JSON array, not null, so the
			// client never has to distinguish the two. Both queries run in
			// one transaction, which is committed after the empty page.
			name:      "empty_page_200",
			method:    http.MethodGet,
			messageID: reactionAuthorsMessageID,
			rawQuery:  "emoji=%F0%9F%94%A5",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(raAccessQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "🔥").
					WillReturnRows(sqlmock.NewRows(raAccessColumns).
						AddRow(handlerChatID, true, 0))
				mock.ExpectQuery(raPageQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "🔥", nil, nil, 51).
					WillReturnRows(sqlmock.NewRows(raPageColumns))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusOK,
			checkBody: func(t *testing.T, body []byte) {
				var resp ReactionAuthorsPage
				require.NoError(t, json.Unmarshal(body, &resp))
				assert.Equal(t, "🔥", resp.Emoji)
				assert.Equal(t, 0, resp.Total)
				assert.NotNil(t, resp.Users, "users must be [] rather than null")
				assert.Empty(t, resp.Users)
				assert.Empty(t, resp.NextCursor)
			},
		},
		{
			// Fewer rows than limit+1 signals the last page: no nextCursor.
			name:      "single_page_200",
			method:    http.MethodGet,
			messageID: reactionAuthorsMessageID,
			rawQuery:  "emoji=%F0%9F%91%8D",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(raAccessQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍").
					WillReturnRows(sqlmock.NewRows(raAccessColumns).
						AddRow(handlerChatID, true, 2))
				mock.ExpectQuery(raPageQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍", nil, nil, 51).
					WillReturnRows(sqlmock.NewRows(raPageColumns).
						AddRow(handlerTargetID, "alice", "Alice", "A", "https://cdn/a.png",
							time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), nil, false, nil).
						AddRow(handlerActorID, "bob", "Bob", "B", "",
							time.Date(2026, 1, 1, 11, 0, 0, 0, time.UTC), nil, false, nil))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusOK,
			checkBody: func(t *testing.T, body []byte) {
				var resp ReactionAuthorsPage
				require.NoError(t, json.Unmarshal(body, &resp))
				assert.Equal(t, "👍", resp.Emoji)
				assert.Equal(t, 2, resp.Total)
				require.Len(t, resp.Users, 2)
				assert.Equal(t, handlerTargetID, resp.Users[0].ID)
				assert.Equal(t, "alice", resp.Users[0].Username)
				assert.Equal(t, "https://cdn/a.png", resp.Users[0].AvatarURL)
				assert.Empty(t, resp.NextCursor)
			},
		},
		{
			// limit=1 makes the service request LIMIT 2; two returned rows
			// mean the page is full and more authors remain.
			name:      "page_with_next_cursor_200",
			method:    http.MethodGet,
			messageID: reactionAuthorsMessageID,
			rawQuery:  "emoji=%F0%9F%91%8D&limit=1",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(raAccessQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍").
					WillReturnRows(sqlmock.NewRows(raAccessColumns).
						AddRow(handlerChatID, true, 3))
				mock.ExpectQuery(raPageQueryPattern).
					WithArgs(reactionAuthorsMessageID, handlerActorID, "👍", nil, nil, 2).
					WillReturnRows(sqlmock.NewRows(raPageColumns).
						AddRow(handlerTargetID, "alice", "Alice", "A", "",
							time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), nil, false, nil).
						AddRow(handlerActorID, "bob", "Bob", "B", "",
							time.Date(2026, 1, 1, 11, 0, 0, 0, time.UTC), nil, false, nil))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusOK,
			checkBody: func(t *testing.T, body []byte) {
				var resp ReactionAuthorsPage
				require.NoError(t, json.Unmarshal(body, &resp))
				assert.Equal(t, 3, resp.Total)
				require.Len(t, resp.Users, 1)
				assert.Equal(t, handlerTargetID, resp.Users[0].ID)
				assert.NotEmpty(t, resp.NextCursor)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mock := newTestHandlerQueryMatcher(t)
			tt.setupMock(mock)

			path := "/api/v2/messages/" + tt.messageID + "/reactions/users"
			if tt.rawQuery != "" {
				path += "?" + tt.rawQuery
			}
			req := newAuthedRequest(tt.method, path, nil, handlerActorID)
			req.SetPathValue("messageId", tt.messageID)

			rr := httptest.NewRecorder()
			h.ListReactionAuthors(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantErrorCode)
			if tt.checkBody != nil {
				// Assert only the media type. The optional "; charset=..."
				// parameter is not required for JSON by RFC 8259, and httpx.JSON
				// is free to change it without breaking the API contract.
				assert.Contains(t, rr.Header().Get("Content-Type"), "application/json")
				tt.checkBody(t, rr.Body.Bytes())
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
