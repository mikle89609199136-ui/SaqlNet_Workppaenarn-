package chat

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	listReactionsUserID    = "00000000-0000-0000-0000-000000000011"
	listReactionsChatID    = "00000000-0000-0000-0000-000000000012"
	listReactionsMessageID = "00000000-0000-0000-0000-000000000013"
)

const listReactionsMessageQuery = `SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`
const listReactionsMembershipQuery = `SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`
const listReactionsAggregateQuery = `
		SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction
		FROM messages.reactions
		WHERE message_id = $1
		GROUP BY emoji
		ORDER BY cnt DESC
	`

func listReactionsRequest(service *Service, messageID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v2/messages/"+messageID+"/reactions", nil)
	req.SetPathValue("messageId", messageID)
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: listReactionsUserID}))

	recorder := httptest.NewRecorder()
	NewHandler(service).ListReactions(recorder, req)
	return recorder
}

func TestListReactions_InvalidUUIDReturns400WithoutSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	recorder := listReactionsRequest(NewService(db, nil, nil), "not-a-uuid")

	assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListReactions_MissingOrDeletedMessageReturns404(t *testing.T) {
	for _, name := range []string{"missing message", "deleted message"} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })

			mock.ExpectQuery(regexp.QuoteMeta(listReactionsMessageQuery)).
				WithArgs(listReactionsMessageID).
				WillReturnError(sql.ErrNoRows)

			recorder := listReactionsRequest(NewService(db, nil, nil), listReactionsMessageID)

			assertErrorResponse(t, recorder, http.StatusNotFound, "not_found")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestListReactions_OutsiderReturns403WithoutReadingAggregates(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectQuery(regexp.QuoteMeta(listReactionsMessageQuery)).
		WithArgs(listReactionsMessageID).
		WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(listReactionsChatID))
	mock.ExpectQuery(regexp.QuoteMeta(listReactionsMembershipQuery)).
		WithArgs(listReactionsUserID, listReactionsChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	recorder := listReactionsRequest(NewService(db, nil, nil), listReactionsMessageID)

	assertErrorResponse(t, recorder, http.StatusForbidden, "access_denied")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListReactions_MemberWithNoReactionsReturnsEmptyArray(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectQuery(regexp.QuoteMeta(listReactionsMessageQuery)).
		WithArgs(listReactionsMessageID).
		WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(listReactionsChatID))
	mock.ExpectQuery(regexp.QuoteMeta(listReactionsMembershipQuery)).
		WithArgs(listReactionsUserID, listReactionsChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(listReactionsAggregateQuery)).
		WithArgs(listReactionsMessageID, listReactionsUserID).
		WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}))

	recorder := listReactionsRequest(NewService(db, nil, nil), listReactionsMessageID)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var response struct {
		Reactions []Reaction `json:"reactions"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.NotNil(t, response.Reactions)
	require.Empty(t, response.Reactions)
	require.NoError(t, mock.ExpectationsWereMet())
}
