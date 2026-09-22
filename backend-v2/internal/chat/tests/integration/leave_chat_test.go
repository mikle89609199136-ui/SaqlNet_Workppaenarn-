package integration

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/chat"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLeaveChat(t *testing.T) {

	ctx := context.Background()
	db := TestDB
	service := chat.NewService(db, nil)

	// t.Cleanup ниже по тексту seedUser/seedChat сами удаляют данные,
	// но для подстраховки можно один раз очистить всё в начале теста.
	t.Cleanup(func() {
		if err := CleanupAllTables(context.Background(), TestDB); err != nil {
			t.Logf("cleanup failed: %v", err)
		}
	})

	t.Run("member leaves group chat", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		memberID := seedUser(t, db, ctx)
		otherID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID:  "owner",
			memberID: "member",
			otherID:  "member",
		})

		seedEncryptionKey(t, db, ctx, chatID, memberID)
		seedUserSettings(t, db, ctx, chatID, memberID)

		require.NoError(t, service.LeaveChat(ctx, memberID, chatID))

		assertMemberExists(t, db, ctx, chatID, memberID, false)
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, otherID, true)
		assertMemberCount(t, db, ctx, chatID, 2)
		assertEncryptionKeyExists(t, db, ctx, chatID, memberID, false)
		assertUserSettingsExist(t, db, ctx, chatID, memberID, false)
	})

	t.Run("leave private chat returns ErrInvalidChatType without mutation", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		otherID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "private", ownerID, map[string]string{
			ownerID: "owner",
			otherID: "member",
		})

		seedEncryptionKey(t, db, ctx, chatID, otherID)
		seedUserSettings(t, db, ctx, chatID, otherID)

		err := service.LeaveChat(ctx, otherID, chatID)
		assert.ErrorIs(t, err, chat.ErrInvalidChatType)

		// Contract: nothing must change for private chats.
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, otherID, true)
		assertMemberCount(t, db, ctx, chatID, 2)
		assertEncryptionKeyExists(t, db, ctx, chatID, otherID, true)
		assertUserSettingsExist(t, db, ctx, chatID, otherID, true)
	})

	t.Run("owner leave returns ErrOwnershipTransferRequired", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		memberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID:  "owner",
			memberID: "member",
		})

		err := service.LeaveChat(ctx, ownerID, chatID)
		assert.ErrorIs(t, err, chat.ErrOwnershipTransferRequired)

		// Membership must remain unchanged.
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, memberID, true)
	})

	t.Run("non-member leave returns ErrForbidden", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		nonMemberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID: "owner",
		})

		err := service.LeaveChat(ctx, nonMemberID, chatID)
		// The service treats a missing member row as forbidden (RowsAffected==0).
		assert.ErrorIs(t, err, chat.ErrForbidden)
	})

	t.Run("chat not found returns ErrNotFound", func(t *testing.T) {
		userID := seedUser(t, db, ctx)
		err := service.LeaveChat(ctx, userID, randomUUID(t))
		assert.ErrorIs(t, err, chat.ErrNotFound)
	})

	t.Run("invalid chat ID returns ErrInvalidInput", func(t *testing.T) {
		userID := seedUser(t, db, ctx)
		err := service.LeaveChat(ctx, userID, "not-a-uuid")
		assert.ErrorIs(t, err, chat.ErrInvalidInput)
	})

	t.Run("leave twice returns ErrForbidden", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		memberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID:  "owner",
			memberID: "member",
		})

		require.NoError(t, service.LeaveChat(ctx, memberID, chatID))

		// Второй вызов: memberRole вернёт ErrForbidden (нет строки в members).
		err := service.LeaveChat(ctx, memberID, chatID)
		assert.ErrorIs(t, err, chat.ErrForbidden)

		// Состояние владельца не должно пострадать.
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberCount(t, db, ctx, chatID, 1)
	})

	t.Run("non-member leave on private chat returns ErrInvalidChatType", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		otherID := seedUser(t, db, ctx)
		nonMemberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "private", ownerID, map[string]string{
			ownerID: "owner",
			otherID: "member",
		})

		// Порядок в сервисе: сначала проверка типа чата, потом memberRole.
		// Значит должен вернуться ErrInvalidChatType, а не ErrForbidden.
		err := service.LeaveChat(ctx, nonMemberID, chatID)
		assert.ErrorIs(t, err, chat.ErrInvalidChatType)

		// Ничего не изменилось.
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, otherID, true)
		assertMemberCount(t, db, ctx, chatID, 2)
	})

	t.Run("invalid user ID returns ErrInvalidInput", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID: "owner",
		})

		// Валидация входа отрабатывает до любого обращения к БД.
		err := service.LeaveChat(ctx, "not-a-uuid", chatID)
		assert.ErrorIs(t, err, chat.ErrInvalidInput)

		// Чат не тронут.
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
	})

}

// seedUser inserts a user and registers a cleanup that removes it after the test.
func seedUser(t *testing.T, db *sql.DB, ctx context.Context) string {
	t.Helper()
	userID := randomUUID(t)
	username := "user_" + strings.ReplaceAll(userID, "-", "")
	_, err := db.ExecContext(ctx,
		`INSERT INTO auth.users (id, username, password_hash, first_name, last_name)
		 VALUES ($1, $2, 'hashed', 'Test', 'User')`,
		userID, username)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM auth.users WHERE id = $1`, userID)
	})
	return userID
}

// seedChat inserts a chat with the given members and registers a cleanup that
// removes it. Because t.Cleanup runs LIFO, the chat is dropped before the users
// created earlier by seedUser, which keeps FK constraints satisfied.
func seedChat(
	t *testing.T,
	db *sql.DB,
	ctx context.Context,
	chatType, ownerID string,
	memberRoles map[string]string,
) string {
	t.Helper()
	chatID := randomUUID(t)
	_, err := db.ExecContext(ctx,
		`INSERT INTO chats.chats (id, type, title, owner_id)
		 VALUES ($1, $2, 'Test Chat', $3)`,
		chatID, chatType, ownerID)
	require.NoError(t, err)

	for userID, role := range memberRoles {
		_, err := db.ExecContext(ctx,
			`INSERT INTO chats.members (chat_id, user_id, role)
			 VALUES ($1, $2, $3)`,
			chatID, userID, role)
		require.NoError(t, err)
	}

	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM chats.chats WHERE id = $1`, chatID)
	})
	return chatID
}

func seedEncryptionKey(t *testing.T, db *sql.DB, ctx context.Context, chatID, userID string) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO crypto.chat_encryption_keys (chat_id, user_id, encrypted_key)
		 VALUES ($1, $2, $3)`,
		chatID, userID, "test-key")
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`,
			chatID, userID)
	})
}

func seedUserSettings(t *testing.T, db *sql.DB, ctx context.Context, chatID, userID string) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO chats.user_chat_settings (user_id, chat_id)
		 VALUES ($1, $2)`,
		userID, chatID)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`,
			userID, chatID)
	})
}

func assertMemberExists(
	t *testing.T,
	db *sql.DB,
	ctx context.Context,
	chatID, userID string,
	shouldExist bool,
) {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM chats.members WHERE chat_id = $1 AND user_id = $2`,
		chatID, userID).Scan(&count))
	if shouldExist {
		assert.Equal(t, 1, count, "user %s should be a member of chat %s", userID, chatID)
	} else {
		assert.Equal(t, 0, count, "user %s should NOT be a member of chat %s", userID, chatID)
	}
}

func assertMemberCount(t *testing.T, db *sql.DB, ctx context.Context, chatID string, expected int) {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM chats.members WHERE chat_id = $1`, chatID).Scan(&count))
	assert.Equal(t, expected, count, "member count mismatch in chat %s", chatID)
}

func assertEncryptionKeyExists(
	t *testing.T,
	db *sql.DB,
	ctx context.Context,
	chatID, userID string,
	shouldExist bool,
) {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`,
		chatID, userID).Scan(&count))
	if shouldExist {
		assert.Equal(t, 1, count, "encryption key for user %s should exist", userID)
	} else {
		assert.Equal(t, 0, count, "encryption key for user %s should be deleted", userID)
	}
}

func assertUserSettingsExist(
	t *testing.T,
	db *sql.DB,
	ctx context.Context,
	chatID, userID string,
	shouldExist bool,
) {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`,
		userID, chatID).Scan(&count))
	if shouldExist {
		assert.Equal(t, 1, count, "settings for user %s should exist", userID)
	} else {
		assert.Equal(t, 0, count, "settings for user %s should be deleted", userID)
	}
}
