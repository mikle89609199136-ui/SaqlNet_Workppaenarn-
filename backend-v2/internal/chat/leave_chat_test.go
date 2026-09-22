package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// TestLeaveChat_Success_memberLeaves проверяет успешный выход участника с ролью member:
// транзакционно удаляются ключи шифрования, персональные настройки и членство.
func TestLeaveChat_Success_memberLeaves(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	// Запросить роль текущего пользователя
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"
	mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id FROM chats.members WHERE chat_id = $1`).
		WithArgs(chatID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(userID).AddRow("550e8400-e29b-41d4-a716-446655440004"))
	mock.ExpectExec(`DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`).
		WithArgs(chatID, userID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM chats.members WHERE chat_id=$1 AND user_id=$2 AND role<>'owner'`).
		WithArgs(chatID, userID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = svc.LeaveChat(context.Background(), userID, chatID)
	require.NoError(t, err)
	err = mock.ExpectationsWereMet()
	require.NoError(t, err)
}

// TestLeaveChat_OwnerCannotLeave проверяет, что владелец не может покинуть группу
// без передачи владения — возвращается ErrOwnershipTransferRequired, SQL-операций нет.
func TestLeaveChat_OwnerCannotLeave(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))

	err = svc.LeaveChat(context.Background(), userID, chatID)
	require.ErrorIs(t, err, chat.ErrOwnershipTransferRequired)
}

// TestLeaveChat_NotMember проверяет выход не-участника (включая повторный выход):
// членство не найдено — возвращается ErrForbidden, транзакция не открывается.
func TestLeaveChat_NotMember(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnError(sql.ErrNoRows)

	err = svc.LeaveChat(context.Background(), userID, chatID)
	require.ErrorIs(t, err, chat.ErrForbidden)
}

// TestLeaveChat_InvalidChatID проверяет отказ при невалидном UUID:
// возвращается ErrInvalidInput, обращений к БД нет.
func TestLeaveChat_InvalidUUID(t *testing.T) {
	db, _, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)
	userID := "not-a-uuid"

	err = svc.LeaveChat(context.Background(), userID, "not-a-uuid")
	require.ErrorIs(t, err, chat.ErrInvalidInput)
}

// TestLeaveChat_RollbackOnSettingsDeleteError проверяет откат транзакции:
// ошибка при удалении user_chat_settings → ROLLBACK, исходная ошибка возвращается наружу.
func TestLeaveChat_RollbackOnSettingsDeleteError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id FROM chats.members WHERE chat_id = $1`).
		WithArgs(chatID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(userID))
	mock.ExpectExec(`DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`).
		WithArgs(chatID, userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	err = svc.LeaveChat(context.Background(), userID, chatID)
	require.Error(t, err)
	require.ErrorIs(t, err, sql.ErrConnDone)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestLeaveChat_RaceMemberDeleted проверяет гонку: членство удалено другим запросом
// между проверкой роли и DELETE (RowsAffected=0) → ROLLBACK и ErrForbidden.
func TestLeaveChat_RaceMemberDeleted(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id FROM chats.members WHERE chat_id = $1`).
		WithArgs(chatID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(userID))
	mock.ExpectExec(`DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`).
		WithArgs(chatID, userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`).
		WithArgs(userID, chatID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM chats.members WHERE chat_id=$1 AND user_id=$2 AND role<>'owner'`).
		WithArgs(chatID, userID).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err = svc.LeaveChat(context.Background(), userID, chatID)
	require.ErrorIs(t, err, chat.ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
}
