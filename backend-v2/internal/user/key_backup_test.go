package user

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	backupUserID = "550e8400-e29b-41d4-a716-446655440101"
	backupChatA  = "550e8400-e29b-41d4-a716-446655440201"
	backupChatB  = "550e8400-e29b-41d4-a716-446655440202"
)

func keyBackupHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return NewHandler(NewService(db), nil), mock
}

func serveKeyBackup(handler *Handler, method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: backupUserID}))
	recorder := httptest.NewRecorder()
	handler.EncryptionRoutes(recorder, req)
	return recorder
}

func requireErrorCode(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	require.Equal(t, status, recorder.Code, recorder.Body.String())
	var body struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, code, body.Code)
}

const validBackupBody = `{"expectedVersion":%s,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":[{"type":"password"}]}`

func backupBody(expectedVersion string) string {
	return strings.Replace(validBackupBody, "%s", expectedVersion, 1)
}

func TestGetKeyBackupReturnsNotFoundWithoutCaching(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectQuery(`SELECT version, format_version, identity, slots`).WithArgs(backupUserID).
		WillReturnError(sql.ErrNoRows)

	recorder := serveKeyBackup(handler, http.MethodGet, "/api/v2/encryption/backup", "")

	requireErrorCode(t, recorder, http.StatusNotFound, "backup_not_found")
	require.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetKeyBackupReturnsOwnBackup(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectQuery(`SELECT version, format_version, identity, slots`).WithArgs(backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"version", "format_version", "identity", "slots", "updated_at"}).
			AddRow(3, 1, "aWRlbnRpdHk=", []byte(`[{"type":"password"}]`), "2026-09-24 10:00:00+00"))

	recorder := serveKeyBackup(handler, http.MethodGet, "/api/v2/encryption/backup", "")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"version":3,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":[{"type":"password"}],"updatedAt":"2026-09-24 10:00:00+00"}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPutKeyBackupCreatesFirstVersion(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectQuery(`INSERT INTO crypto\.key_backups`).
		WithArgs(backupUserID, 1, "aWRlbnRpdHk=", []byte(`[{"type":"password"}]`)).
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(1))

	recorder := serveKeyBackup(handler, http.MethodPut, "/api/v2/encryption/backup", backupBody("0"))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"version":1}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPutKeyBackupRejectsStaleVersion(t *testing.T) {
	tests := []struct {
		name            string
		expectedVersion string
		setup           func(mock sqlmock.Sqlmock)
	}{
		{
			name:            "create when a backup already exists",
			expectedVersion: "0",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`INSERT INTO crypto\.key_backups`).WillReturnError(sql.ErrNoRows)
			},
		},
		{
			name:            "update from an outdated version",
			expectedVersion: "2",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`UPDATE crypto\.key_backups`).
					WithArgs(backupUserID, int64(2), 1, "aWRlbnRpdHk=", []byte(`[{"type":"password"}]`)).
					WillReturnError(sql.ErrNoRows)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := keyBackupHandler(t)
			tt.setup(mock)

			recorder := serveKeyBackup(handler, http.MethodPut, "/api/v2/encryption/backup", backupBody(tt.expectedVersion))

			requireErrorCode(t, recorder, http.StatusConflict, "version_conflict")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestPutKeyBackupRejectsInvalidPayloadWithoutDatabaseWrite(t *testing.T) {
	tooManySlots := "[" + strings.TrimSuffix(strings.Repeat(`{"type":"password"},`, maxBackupSlots+1), ",") + "]"
	tests := []struct {
		name string
		body string
	}{
		{name: "identity is not base64", body: `{"expectedVersion":0,"formatVersion":1,"identity":"not base64!","slots":[{}]}`},
		{name: "identity is too large", body: `{"expectedVersion":0,"formatVersion":1,"identity":"` + strings.Repeat("A", maxBackupIdentityBytes+4) + `","slots":[{}]}`},
		{name: "no format version", body: `{"expectedVersion":0,"identity":"aWRlbnRpdHk=","slots":[{}]}`},
		{name: "slots is not an array", body: `{"expectedVersion":0,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":{"type":"password"}}`},
		{name: "no slots", body: `{"expectedVersion":0,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":[]}`},
		{name: "slot is not an object", body: `{"expectedVersion":0,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":["password"]}`},
		{name: "too many slots", body: `{"expectedVersion":0,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":` + tooManySlots + `}`},
		{name: "negative version", body: `{"expectedVersion":-1,"formatVersion":1,"identity":"aWRlbnRpdHk=","slots":[{}]}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := keyBackupHandler(t)

			recorder := serveKeyBackup(handler, http.MethodPut, "/api/v2/encryption/backup", tt.body)

			requireErrorCode(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestDeleteKeyBackupRemovesChatKeysToo(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM crypto\.chat_key_backups WHERE user_id = \$1`).WithArgs(backupUserID).
		WillReturnResult(sqlmock.NewResult(0, 4))
	mock.ExpectExec(`DELETE FROM crypto\.key_backups WHERE user_id = \$1`).WithArgs(backupUserID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	recorder := serveKeyBackup(handler, http.MethodDelete, "/api/v2/encryption/backup", "")

	require.Equal(t, http.StatusNoContent, recorder.Code, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveBackupChatKeysKeepsExistingEpochs(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO crypto\.chat_key_backups[\s\S]*WHERE EXISTS[\s\S]*ON CONFLICT \(user_id, chat_id, key_epoch\) DO NOTHING`).
		WithArgs(backupUserID, backupChatA, 1, "a2V5MQ==").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO crypto\.chat_key_backups`).
		WithArgs(backupUserID, backupChatA, 2, "a2V5Mg==").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/backup/chat-keys",
		`{"keys":[{"chatId":"`+backupChatA+`","epoch":1,"encryptedKey":"a2V5MQ=="},{"chatId":"`+backupChatA+`","epoch":2,"encryptedKey":"a2V5Mg=="}]}`)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"stored":1}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveBackupChatKeysRejectsInvalidBatchWithoutDatabaseWrite(t *testing.T) {
	tooMany := make([]string, maxBackupChatKeysPerBatch+1)
	for i := range tooMany {
		tooMany[i] = `{"chatId":"` + backupChatA + `","epoch":1,"encryptedKey":"a2V5"}`
	}
	tests := []struct {
		name string
		body string
	}{
		{name: "empty batch", body: `{"keys":[]}`},
		{name: "chat id is not a uuid", body: `{"keys":[{"chatId":"chat","epoch":1,"encryptedKey":"a2V5"}]}`},
		{name: "epoch below one", body: `{"keys":[{"chatId":"` + backupChatA + `","epoch":0,"encryptedKey":"a2V5"}]}`},
		{name: "key is not base64", body: `{"keys":[{"chatId":"` + backupChatA + `","epoch":1,"encryptedKey":"not base64!"}]}`},
		{name: "key is too large", body: `{"keys":[{"chatId":"` + backupChatA + `","epoch":1,"encryptedKey":"` + strings.Repeat("A", maxBackupChatKeyBytes+4) + `"}]}`},
		{name: "too many keys", body: `{"keys":[` + strings.Join(tooMany, ",") + `]}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := keyBackupHandler(t)

			recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/backup/chat-keys", tt.body)

			requireErrorCode(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestListBackupChatKeysPagesByChatAndEpoch(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectQuery(`SELECT chat_id::text, key_epoch, encrypted_key[\s\S]*ORDER BY chat_id, key_epoch`).
		WithArgs(backupUserID, "", zeroUUID, 0, 3).
		WillReturnRows(sqlmock.NewRows([]string{"chat_id", "key_epoch", "encrypted_key"}).
			AddRow(backupChatA, 1, "a2V5MQ==").
			AddRow(backupChatA, 2, "a2V5Mg==").
			AddRow(backupChatB, 1, "a2V5Mw=="))

	recorder := serveKeyBackup(handler, http.MethodGet, "/api/v2/encryption/backup/chat-keys?limit=2", "")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	require.JSONEq(t, `{"keys":[
		{"chatId":"`+backupChatA+`","epoch":1,"encryptedKey":"a2V5MQ=="},
		{"chatId":"`+backupChatA+`","epoch":2,"encryptedKey":"a2V5Mg=="}
	],"next":"`+backupChatA+`:2"}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListBackupChatKeysContinuesFromCursorForOneChat(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectQuery(`SELECT chat_id::text, key_epoch, encrypted_key`).
		WithArgs(backupUserID, backupChatA, backupChatA, 2, defaultBackupChatKeysPage+1).
		WillReturnRows(sqlmock.NewRows([]string{"chat_id", "key_epoch", "encrypted_key"}).
			AddRow(backupChatA, 3, "a2V5NA=="))

	recorder := serveKeyBackup(handler, http.MethodGet,
		"/api/v2/encryption/backup/chat-keys?chatId="+backupChatA+"&after="+backupChatA+":2", "")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"keys":[{"chatId":"`+backupChatA+`","epoch":3,"encryptedKey":"a2V5NA=="}],"next":""}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListBackupChatKeysRejectsInvalidQueryWithoutDatabaseRead(t *testing.T) {
	for _, target := range []string{
		"/api/v2/encryption/backup/chat-keys?chatId=chat",
		"/api/v2/encryption/backup/chat-keys?after=broken",
		"/api/v2/encryption/backup/chat-keys?after=" + backupChatA + ":x",
		"/api/v2/encryption/backup/chat-keys?limit=many",
	} {
		t.Run(target, func(t *testing.T) {
			handler, mock := keyBackupHandler(t)

			recorder := serveKeyBackup(handler, http.MethodGet, target, "")

			requireErrorCode(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestKeyBackupMigrationDefinesTables(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/0024_key_backups.sql")
	require.NoError(t, err)
	source := string(raw)
	for _, fragment := range []string{
		"CREATE TABLE IF NOT EXISTS crypto.key_backups",
		"user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE",
		"CREATE TABLE IF NOT EXISTS crypto.chat_key_backups",
		"PRIMARY KEY (user_id, chat_id, key_epoch)",
		"REFERENCES chats.chats(id) ON DELETE CASCADE",
	} {
		require.Contains(t, source, fragment)
	}
}
