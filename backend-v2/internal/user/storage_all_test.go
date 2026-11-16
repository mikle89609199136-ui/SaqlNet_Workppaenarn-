package user

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	deleteAllUserID          = "55555555-5555-4555-8555-555555555555"
	deleteAllTokenGeneration = int64(7)
)

// notifyPayload matches a pg_notify payload by the session hash it must carry,
// so expectations stay independent of the exact JSON field layout.
type notifyPayload struct{ tokenHash string }

func (m notifyPayload) Match(value driver.Value) bool {
	payload, ok := value.(string)
	return ok && strings.Contains(payload, m.tokenHash)
}

// expectDeleteAllDataSuccess enqueues the ordered happy-path statements of
// DeleteAllData plus the final commit. sqlmock's ordered mode makes a reordered,
// extra or missing statement fail the test.
func expectDeleteAllDataSuccess(mock sqlmock.Sqlmock, hashes ...string) {
	sessionRows := sqlmock.NewRows([]string{"access_token_hash"})
	for _, hash := range hashes {
		sessionRows.AddRow(hash)
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`SET LOCAL lock_timeout = '5s'`)).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT token_generation FROM auth.users`)).WithArgs(deleteAllUserID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(deleteAllTokenGeneration))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT access_token_hash FROM auth.sessions`)).WithArgs(deleteAllUserID).WillReturnRows(sessionRows)
	for _, statement := range []string{
		`UPDATE messages.messages SET reply_to = NULL`,
		`DELETE FROM messages.messages WHERE sender_id = $1`,
		`DELETE FROM chats.chats WHERE owner_id = $1`,
		`UPDATE chats.bans SET banned_by = NULL WHERE banned_by = $1`,
		`UPDATE calls.rooms SET initiator_id = NULL WHERE initiator_id = $1`,
		`UPDATE admin.reports SET resolved_by = NULL WHERE resolved_by = $1`,
		`DELETE FROM crypto.group_mls_proposals WHERE sender_id = $1`,
		`DELETE FROM crypto.group_mls_welcome WHERE sender_id = $1`,
		`DELETE FROM crypto.group_mls_commits WHERE sender_id = $1`,
		`DELETE FROM auth.revoked_tokens WHERE user_id = $1`,
	} {
		mock.ExpectExec(regexp.QuoteMeta(statement)).WithArgs(deleteAllUserID).WillReturnResult(sqlmock.NewResult(1, 1))
	}
	for _, hash := range hashes {
		mock.ExpectExec(regexp.QuoteMeta(`SELECT pg_notify`)).
			WithArgs(authctx.RevocationChannel, notifyPayload{tokenHash: hash}).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM auth.users WHERE id = $1`)).WithArgs(deleteAllUserID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

// TestDeleteAllDataSuccessOrder verifies the happy path issues every documented
// statement in order and commits exactly once.
func TestDeleteAllDataSuccessOrder(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	expectDeleteAllDataSuccess(mock, "hash-a", "hash-b")

	require.NoError(t, NewService(db).DeleteAllData(context.Background(), deleteAllUserID))
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestDeleteAllDataNotifiesEachHash verifies exactly one pg_notify per session
// hash and no notification more: the notify expectations sit before
// DELETE FROM auth.users, so an extra call fails the ordered mock.
func TestDeleteAllDataNotifiesEachHash(t *testing.T) {
	for _, tt := range []struct {
		name   string
		hashes []string
	}{
		{name: "single session", hashes: []string{"hash-a"}},
		{name: "two sessions", hashes: []string{"hash-a", "hash-b"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })
			expectDeleteAllDataSuccess(mock, tt.hashes...)

			require.NoError(t, NewService(db).DeleteAllData(context.Background(), deleteAllUserID))
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestDeleteAllDataReturnsSuccess verifies the storage-all handler responds 200
// with {"success":true} once the service commits.
func TestDeleteAllDataReturnsSuccess(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	expectDeleteAllDataSuccess(mock, "hash-a", "hash-b")

	request := httptest.NewRequest(http.MethodDelete, "/api/v2/users/storage/all", strings.NewReader(`{"confirm":"DELETE_ALL_DATA"}`))
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: deleteAllUserID}))
	response := httptest.NewRecorder()
	NewHandler(NewService(db), nil).Storage(response, request)

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"success":true}`, response.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestDeleteAllDataRequiresConfirmation verifies that a request without the
// exact confirm keyword is rejected with 400 before any SQL runs: sqlmock is
// created with no expectations, so a single statement would fail the test.
func TestDeleteAllDataRequiresConfirmation(t *testing.T) {
	for _, tt := range []struct {
		name    string
		body    string
		nilBody bool
	}{
		{name: "missing body", nilBody: true},
		{name: "empty object", body: `{}`},
		{name: "empty confirm", body: `{"confirm":""}`},
		{name: "lowercase confirm", body: `{"confirm":"delete_all_data"}`},
		{name: "leading space", body: `{"confirm":" DELETE_ALL_DATA"}`},
		{name: "numeric confirm", body: `{"confirm":123}`},
		{name: "null confirm", body: `{"confirm":null}`},
		{name: "malformed json", body: `{invalid`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })

			request := httptest.NewRequest(http.MethodDelete, "/api/v2/users/storage/all", nil)
			if !tt.nilBody {
				request = httptest.NewRequest(http.MethodDelete, "/api/v2/users/storage/all", strings.NewReader(tt.body))
			}
			request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: deleteAllUserID}))
			response := httptest.NewRecorder()
			NewHandler(NewService(db), nil).Storage(response, request)

			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			require.JSONEq(t, `{"code":"confirmation_required","message":"confirm must equal DELETE_ALL_DATA"}`, response.Body.String())
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestDeleteAllDataIdempotentWhenUserGone verifies a repeat call for an already
// deleted account commits as a no-op: ErrNoRows on the locking select ends the
// transaction before any delete or notify statement is issued.
func TestDeleteAllDataIdempotentWhenUserGone(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`SET LOCAL lock_timeout = '5s'`)).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT token_generation FROM auth.users`)).WithArgs(deleteAllUserID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()

	require.NoError(t, NewService(db).DeleteAllData(context.Background(), deleteAllUserID))
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestDeleteAllDataRollsBackOnMidBatchError verifies a failing batch statement
// aborts the whole transaction: the error wraps the failing step and the
// deferred rollback runs, so no pg_notify is ever delivered.
func TestDeleteAllDataRollsBackOnMidBatchError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	sessionRows := sqlmock.NewRows([]string{"access_token_hash"}).AddRow("hash-a")
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`SET LOCAL lock_timeout = '5s'`)).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT token_generation FROM auth.users`)).WithArgs(deleteAllUserID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(deleteAllTokenGeneration))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT access_token_hash FROM auth.sessions`)).WithArgs(deleteAllUserID).WillReturnRows(sessionRows)
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE messages.messages SET reply_to = NULL`)).WithArgs(deleteAllUserID).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM messages.messages WHERE sender_id = $1`)).WithArgs(deleteAllUserID).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM chats.chats WHERE owner_id = $1`)).WithArgs(deleteAllUserID).
		WillReturnError(errors.New("deadlock detected"))
	mock.ExpectRollback()

	err = NewService(db).DeleteAllData(context.Background(), deleteAllUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "delete owned chats")
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestDeleteAllDataRollsBackOnNotifyError verifies a failing pg_notify aborts
// the transaction instead of committing a half-finished withdrawal: the error
// wraps the notify step, the rollback runs, and neither DELETE FROM auth.users
// nor a commit is ever issued (ordered mock has no expectation for them).
func TestDeleteAllDataRollsBackOnNotifyError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	sessionRows := sqlmock.NewRows([]string{"access_token_hash"}).AddRow("hash-a")
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`SET LOCAL lock_timeout = '5s'`)).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT token_generation FROM auth.users`)).WithArgs(deleteAllUserID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(deleteAllTokenGeneration))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT access_token_hash FROM auth.sessions`)).WithArgs(deleteAllUserID).WillReturnRows(sessionRows)
	for _, statement := range []string{
		`UPDATE messages.messages SET reply_to = NULL`,
		`DELETE FROM messages.messages WHERE sender_id = $1`,
		`DELETE FROM chats.chats WHERE owner_id = $1`,
		`UPDATE chats.bans SET banned_by = NULL WHERE banned_by = $1`,
		`UPDATE calls.rooms SET initiator_id = NULL WHERE initiator_id = $1`,
		`UPDATE admin.reports SET resolved_by = NULL WHERE resolved_by = $1`,
		`DELETE FROM crypto.group_mls_proposals WHERE sender_id = $1`,
		`DELETE FROM crypto.group_mls_welcome WHERE sender_id = $1`,
		`DELETE FROM crypto.group_mls_commits WHERE sender_id = $1`,
		`DELETE FROM auth.revoked_tokens WHERE user_id = $1`,
	} {
		mock.ExpectExec(regexp.QuoteMeta(statement)).WithArgs(deleteAllUserID).WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectExec(regexp.QuoteMeta(`SELECT pg_notify`)).
		WithArgs(authctx.RevocationChannel, notifyPayload{tokenHash: "hash-a"}).
		WillReturnError(errors.New("notify failed"))
	mock.ExpectRollback()

	err = NewService(db).DeleteAllData(context.Background(), deleteAllUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "notify revocation")
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestDeleteAllDataHandlerRejectsConfirmation verifies the handler answers 400
// with the confirmation_required code for an empty body instead of touching the
// database.
func TestDeleteAllDataHandlerRejectsConfirmation(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	request := httptest.NewRequest(http.MethodDelete, "/api/v2/users/storage/all", nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: deleteAllUserID}))
	response := httptest.NewRecorder()
	NewHandler(NewService(db), nil).Storage(response, request)

	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	assert.Contains(t, response.Body.String(), `"code":"confirmation_required"`)
	require.NoError(t, mock.ExpectationsWereMet())
}
