package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
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

// TestService_LeaveChat_Intergration tests the LeaveChat service method using the shared
// PostgreSQL container and cleanup after each subtest.
func TestService_LeaveChat_Integration(t *testing.T) {
	// Use the shared database connection
	db := TestDB

	// Create service with shared DB
	service := &Service{
		db: db,
		ws: nil,
	}

	// Helper to insert a user
	insertUser := func(ctx context.Context, t *testing.T, userID, username string) {
		_, err := db.ExecContext(ctx,
			`INSERT INTO auth.users (id, username, password_hash, first_name, last_name) 
			 VALUES ($1, $2, 'hashed', 'Test', 'User')`,
			userID, username)
		require.NoError(t, err)
	}

	// Helper to insert a chat
	insertChat := func(ctx context.Context, t *testing.T, chatID, chatType, ownerID, title string) {
		_, err := db.ExecContext(ctx,
			`INSERT INTO chats.chats (id, type, owner_id, title) VALUES ($1, $2, $3, $4)`,
			chatID, chatType, ownerID, title)
		require.NoError(t, err)
	}

	// Helper to insert a member
	insertMember := func(ctx context.Context, t *testing.T, chatID, userID, role string) {
		_, err := db.ExecContext(ctx,
			`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, $3)`,
			chatID, userID, role)
		require.NoError(t, err)
	}

	// Helper to insert an encryption key
	insertEncryptionKey := func(ctx context.Context, t *testing.T, chatID, userID string) {
		_, err := db.ExecContext(ctx,
			`INSERT INTO crypto.chat_encryption_keys (chat_id, user_id, key) VALUES ($1, $2, 'test-key')`,
			chatID, userID)
		require.NoError(t, err)
	}

	// Helper to insert user settings
	insertUserSettings := func(ctx context.Context, t *testing.T, chatID, userID string) {
		_, err := db.ExecContext(ctx,
			`INSERT INTO chats.user_chat_settings (user_id, chat_id, settings) VALUES ($1, $2, '{}')`,
			userID, chatID)
		require.NoError(t, err)
	}

	// Helper to assert membership existence
	assertMemberExists := func(ctx context.Context, t *testing.T, chatID, userID string, shouldExist bool) {
		var count int
		err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM chats.members WHERE chat_id = $1 AND user_id = $2`,
			chatID, userID).Scan(&count)
		require.NoError(t, err)
		if shouldExist {
			assert.Equal(t, 1, count, "user should be a member")
		} else {
			assert.Equal(t, 0, count, "user should NOT be a member")
		}
	}

	// Helper to assert total member count
	assertMemberCount := func(ctx context.Context, t *testing.T, chatID string, expected int) {
		var count int
		err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM chats.members WHERE chat_id = $1`, chatID).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, expected, count, "member count mismatch")
	}

	// Helper to assert encryption key existence
	assertEncryptionKeysExist := func(ctx context.Context, t *testing.T, chatID, userID string, shouldExist bool) {
		var count int
		err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`,
			chatID, userID).Scan(&count)
		require.NoError(t, err)
		if shouldExist {
			assert.Equal(t, 1, count, "encryption key should exist")
		} else {
			assert.Equal(t, 0, count, "encryption key should be deleted")
		}
	}

	// Helper to assert user settings existence
	assertUserSettingsExist := func(ctx context.Context, t *testing.T, chatID, userID string, shouldExist bool) {
		var count int
		err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`,
			userID, chatID).Scan(&count)
		require.NoError(t, err)
		if shouldExist {
			assert.Equal(t, 1, count, "user settings should exist")
		} else {
			assert.Equal(t, 0, count, "user settings should be deleted")
		}
	}

	// ============================================================
	// POSITIVE TEST: successful leave from group chat
	// ============================================================
	t.Run("successful leave from group chat", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		// Clean up after this subtest
		t.Cleanup(func() {
			_ = CleanupAllTables(context.Background(), db)
		})

		chatID := "550e8400-e29b-41d4-a716-446655440011"
		ownerID := "user-owner-1"
		leaverID := "user-leaver-1"
		otherID := "user-other-1"

		insertUser(ctx, t, ownerID, "owner")
		insertUser(ctx, t, leaverID, "leaver")
		insertUser(ctx, t, otherID, "other")

		insertChat(ctx, t, chatID, "group", ownerID, "Test Group")
		insertMember(ctx, t, chatID, ownerID, "owner")
		insertMember(ctx, t, chatID, leaverID, "member")
		insertMember(ctx, t, chatID, otherID, "member")

		insertEncryptionKey(ctx, t, chatID, leaverID)
		insertUserSettings(ctx, t, chatID, leaverID)

		err := service.LeaveChat(ctx, leaverID, chatID)
		require.NoError(t, err)

		assertMemberExists(ctx, t, chatID, leaverID, false)
		assertMemberExists(ctx, t, chatID, ownerID, true)
		assertMemberExists(ctx, t, chatID, otherID, true)
		assertMemberCount(ctx, t, chatID, 2)
		assertEncryptionKeysExist(ctx, t, chatID, leaverID, false)
		assertUserSettingsExist(ctx, t, chatID, leaverID, false)
	})

	// ============================================================
	// NEGATIVE TEST: leave private chat → ErrInvalidChatType
	// ============================================================
	t.Run("leave private chat - should return ErrInvalidChatType", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		t.Cleanup(func() {
			_ = CleanupAllTables(context.Background(), db)
		})

		chatID := "550e8400-e29b-41d4-a716-446655440012"
		userID := "user-private-1"
		otherID := "user-private-2"

		insertUser(ctx, t, userID, "private1")
		insertUser(ctx, t, otherID, "private2")

		insertChat(ctx, t, chatID, "private", userID, "Private Chat")
		insertMember(ctx, t, chatID, userID, "owner")
		insertMember(ctx, t, chatID, otherID, "member")

		err := service.LeaveChat(ctx, userID, chatID)
		assert.ErrorIs(t, err, ErrInvalidChatType)
	})

	// ============================================================
	// NEGATIVE TEST: owner tries to leave → ErrOwnershipTransferRequired
	// ============================================================
	t.Run("owner leave - should return ErrOwnershipTransferRequired", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		t.Cleanup(func() {
			_ = CleanupAllTables(context.Background(), db)
		})

		chatID := "550e8400-e29b-41d4-a716-446655440013"
		ownerID := "user-owner-2"
		memberID := "user-member-2"

		insertUser(ctx, t, ownerID, "owner2")
		insertUser(ctx, t, memberID, "member2")

		insertChat(ctx, t, chatID, "group", ownerID, "Test Group")
		insertMember(ctx, t, chatID, ownerID, "owner")
		insertMember(ctx, t, chatID, memberID, "member")

		err := service.LeaveChat(ctx, ownerID, chatID)
		assert.ErrorIs(t, err, ErrOwnershipTransferRequired)
	})

	// ============================================================
	// NEGATIVE TEST: non-member tries to leave → ErrNotFound
	// ============================================================
	t.Run("non-member leave - should return ErrNotFound", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		t.Cleanup(func() {
			_ = CleanupAllTables(context.Background(), db)
		})

		chatID := "550e8400-e29b-41d4-a716-446655440014"
		ownerID := "user-owner-3"
		nonMemberID := "user-nonmember-1"

		insertUser(ctx, t, ownerID, "owner3")
		insertUser(ctx, t, nonMemberID, "nonmember")

		insertChat(ctx, t, chatID, "group", ownerID, "Test Group")
		insertMember(ctx, t, chatID, ownerID, "owner")

		err := service.LeaveChat(ctx, nonMemberID, chatID)
		assert.ErrorIs(t, err, ErrNotFound)
	})

	// ============================================================
	// NEGATIVE TEST: invalid chat ID (non-UUID) → ErrInvalidInput
	// ============================================================
	t.Run("invalid chat ID - should return ErrInvalidInput", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		t.Cleanup(func() {
			_ = CleanupAllTables(context.Background(), db)
		})

		userID := "user-valid-1"
		insertUser(ctx, t, userID, "validuser")

		err := service.LeaveChat(ctx, userID, "not-a-uuid")
		assert.ErrorIs(t, err, ErrInvalidInput)
	})
}
