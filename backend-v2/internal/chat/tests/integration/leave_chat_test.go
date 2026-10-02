//go:build integration

package integration

import (
	"context"
	"testing"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLeaveChat covers the LeaveChat service method end to end against a real
// PostgreSQL instance. All cases share the package-level TestDB set up in
// TestMain; each subtest seeds its own users and chats so it can run in any
// order. Registered t.Cleanup wipes mutable state after the whole test.
func TestLeaveChat(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	service := chat.NewService(db, nil, nil)

	t.Cleanup(func() {
		truncateTables(t, db, context.Background())
	})

	// Happy path: a regular member leaves a group chat. Verifies that
	// membership, encryption keys and per-user settings for the leaver are
	// removed, while the owner and other members are untouched.
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

	// Contract: leaving is only defined for group chats. For a participant
	// of a private chat the service must reject the call before touching any
	// state, so every row (members, keys, settings) must remain exactly as
	// seeded.
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

		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, otherID, true)
		assertMemberCount(t, db, ctx, chatID, 2)
		assertEncryptionKeyExists(t, db, ctx, chatID, otherID, true)
		assertUserSettingsExist(t, db, ctx, chatID, otherID, true)
	})

	// The owner cannot leave without first transferring ownership; the
	// service must refuse the call and leave the membership table untouched.
	t.Run("owner leave returns ErrOwnershipTransferRequired", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		memberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID:  "owner",
			memberID: "member",
		})

		err := service.LeaveChat(ctx, ownerID, chatID)
		assert.ErrorIs(t, err, chat.ErrOwnershipTransferRequired)

		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, memberID, true)
	})

	// A user who is not a member of the chat at all must be rejected with
	// ErrForbidden (maps to 403 at the HTTP layer). Membership is checked
	// before the chat type, so outsiders cannot use LeaveChat to distinguish
	// a private chat from a group chat by UUID.
	t.Run("non-member leave returns ErrForbidden", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		nonMemberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID: "owner",
		})

		err := service.LeaveChat(ctx, nonMemberID, chatID)
		assert.ErrorIs(t, err, chat.ErrForbidden)
	})

	// Unknown chat ID must fail early with ErrNotFound, which the handler
	// translates to a 404.
	t.Run("chat not found returns ErrNotFound", func(t *testing.T) {
		userID := seedUser(t, db, ctx)
		err := service.LeaveChat(ctx, userID, randomUUID(t))
		assert.ErrorIs(t, err, chat.ErrNotFound)
	})

	// Input validation must run before any SQL. A malformed chat ID yields
	// ErrInvalidInput, which the handler maps to 400.
	t.Run("invalid chat ID returns ErrInvalidInput", func(t *testing.T) {
		userID := seedUser(t, db, ctx)
		err := service.LeaveChat(ctx, userID, "not-a-uuid")
		assert.ErrorIs(t, err, chat.ErrInvalidInput)
	})

	// Idempotency guard: after a member leaves once, the second call must
	// fail. At that point the member row no longer exists, so the membership
	// check returns ErrForbidden before any mutation happens.
	t.Run("leave twice returns ErrForbidden", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		memberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID:  "owner",
			memberID: "member",
		})

		require.NoError(t, service.LeaveChat(ctx, memberID, chatID))

		err := service.LeaveChat(ctx, memberID, chatID)
		assert.ErrorIs(t, err, chat.ErrForbidden)

		// The owner's membership must survive the failed second call.
		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberCount(t, db, ctx, chatID, 1)
	})

	// Information-disclosure contract: a non-member always gets ErrForbidden,
	// regardless of the chat's type. Returning ErrInvalidChatType to an
	// outsider would leak the chat's type to anyone who knows its UUID,
	// letting them distinguish a private chat from a group chat.
	t.Run("non-member leave on private chat returns ErrForbidden", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		otherID := seedUser(t, db, ctx)
		nonMemberID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "private", ownerID, map[string]string{
			ownerID: "owner",
			otherID: "member",
		})

		err := service.LeaveChat(ctx, nonMemberID, chatID)
		assert.ErrorIs(t, err, chat.ErrForbidden)

		assertMemberExists(t, db, ctx, chatID, ownerID, true)
		assertMemberExists(t, db, ctx, chatID, otherID, true)
		assertMemberCount(t, db, ctx, chatID, 2)
	})

	// Input validation runs before any DB access, so a malformed user ID
	// must be rejected even though the chat exists and would otherwise
	// produce a different error.
	t.Run("invalid user ID returns ErrInvalidInput", func(t *testing.T) {
		ownerID := seedUser(t, db, ctx)
		chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
			ownerID: "owner",
		})

		err := service.LeaveChat(ctx, "not-a-uuid", chatID)
		assert.ErrorIs(t, err, chat.ErrInvalidInput)

		assertMemberExists(t, db, ctx, chatID, ownerID, true)
	})
}
