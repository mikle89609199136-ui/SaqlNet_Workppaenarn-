package user

import (
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// Запись ключей чата (#806): эпоха проверяется под блокировкой строки чата,
// ответы 409 различают «ключ уже сменили» и «сначала смените ключ».

const chatKeysChatID = "550e8400-e29b-41d4-a716-446655440301"

func expectKeyWriteStart(mock sqlmock.Sqlmock, rotationNeeded bool, currentEpoch int) {
	mock.ExpectQuery(`SELECT 1 FROM chats.members`).WithArgs(chatKeysChatID, backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT key_rotation_needed FROM chats.chats WHERE id = \$1 FOR UPDATE`).WithArgs(chatKeysChatID).
		WillReturnRows(sqlmock.NewRows([]string{"key_rotation_needed"}).AddRow(rotationNeeded))
	mock.ExpectQuery(`SELECT COALESCE\(MAX\(key_epoch\), 0\) FROM crypto.chat_encryption_keys`).WithArgs(chatKeysChatID).
		WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(currentEpoch))
}

func expectRotationBudget(mock sqlmock.Sqlmock, used int) {
	mock.ExpectQuery(`SELECT 1 FROM chats.members`).WithArgs(chatKeysChatID, backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM crypto.audit_log`).WithArgs(chatKeysChatID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(used))
}

func chatKeysBody(epoch string) string {
	return `{"keyEpoch":` + epoch + `,"encryptedKeys":[{"userId":"` + backupUserID + `","encryptedKey":"a2V5","keyEpoch":` + epoch + `}]}`
}

func TestRotateChatKeyRejectsStaleEpoch(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	expectRotationBudget(mock, 0)
	expectKeyWriteStart(mock, true, 3)
	mock.ExpectRollback()

	recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/rotate-key/"+chatKeysChatID, chatKeysBody("3"))

	requireErrorCode(t, recorder, http.StatusConflict, "key_epoch_conflict")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveChatKeysRefusesCurrentEpochWhileRotationNeeded(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	expectKeyWriteStart(mock, true, 2)
	mock.ExpectRollback()

	recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/chat-keys/"+chatKeysChatID, chatKeysBody("2"))

	requireErrorCode(t, recorder, http.StatusConflict, "key_rotation_required")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveChatKeysHealsCurrentEpochWithoutClearingFlag(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	expectKeyWriteStart(mock, false, 2)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chats.members`).WithArgs(chatKeysChatID, backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`INSERT INTO crypto.chat_encryption_keys`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/chat-keys/"+chatKeysChatID, chatKeysBody("2"))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRotateChatKeyWritesNextEpochAndClearsFlag(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	expectRotationBudget(mock, 0)
	expectKeyWriteStart(mock, true, 2)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chats.members`).WithArgs(chatKeysChatID, backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`INSERT INTO crypto.chat_encryption_keys`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE chats.chats SET key_rotation_needed = FALSE`).WithArgs(chatKeysChatID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO crypto.audit_log`).WithArgs(backupUserID, chatKeysChatID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/rotate-key/"+chatKeysChatID, chatKeysBody("3"))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"ok":true,"keyEpoch":3}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRotateChatKeyRateLimited(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	expectRotationBudget(mock, maxKeyRotationsPerHour)

	recorder := serveKeyBackup(handler, http.MethodPost, "/api/v2/encryption/rotate-key/"+chatKeysChatID, chatKeysBody("3"))

	requireErrorCode(t, recorder, http.StatusTooManyRequests, "rate_limited")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetChatKeysReportsEpochAndRotationFlag(t *testing.T) {
	handler, mock := keyBackupHandler(t)
	mock.ExpectQuery(`SELECT 1 FROM chats.members`).WithArgs(chatKeysChatID, backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectQuery(`SELECT cek.user_id::text`).WithArgs(chatKeysChatID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "encrypted_key", "sender_key_id", "pq_ciphertext", "key_epoch"}).
			AddRow(backupUserID, "a2V5", nil, nil, 2))
	mock.ExpectQuery(`SELECT 1 FROM chats.members`).WithArgs(chatKeysChatID, backupUserID).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))
	mock.ExpectQuery(`SELECT c.key_rotation_needed`).WithArgs(chatKeysChatID).
		WillReturnRows(sqlmock.NewRows([]string{"key_rotation_needed", "max"}).AddRow(true, 2))

	recorder := serveKeyBackup(handler, http.MethodGet, "/api/v2/encryption/chat-keys/"+chatKeysChatID, "")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.JSONEq(t, `{"keys":[{"userId":"`+backupUserID+`","encryptedKey":"a2V5","keyEpoch":2}],"keyEpoch":2,"rotationNeeded":true}`, recorder.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}
