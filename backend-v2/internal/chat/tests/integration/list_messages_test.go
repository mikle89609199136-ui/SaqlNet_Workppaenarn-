//go:build integration

package integration

import (
	"context"
	"testing"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/require"
)

// TestListMessages_Integration covers ListMessages against a real PostgreSQL
// instance:
//
//   - ErrNotFound for an unknown chat ID (maps to 404),
//   - ErrForbidden for a non-member of an existing chat (maps to 403),
//   - successful read for a member, returning the seeded message.
//
// Uses the shared TestDB from TestMain; each subtest seeds its own users and
// chats. Registered t.Cleanup wipes all mutable state after the whole test,
// so it can run in any order relative to other tests in the package.
func TestListMessages_Integration(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	service := chat.NewService(db, nil, nil)

	t.Cleanup(func() {
		truncateTables(t, db, context.Background())
	})

	ownerID := seedUser(t, db, ctx)
	memberID := seedUser(t, db, ctx)
	outsiderID := seedUser(t, db, ctx)

	chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
		ownerID:  "owner",
		memberID: "member",
	})

	seedMessage(t, db, ctx, chatID, ownerID, "integration test message")

	// Unknown chat ID must fail early with ErrNotFound.
	_, err := service.ListMessages(ctx, memberID, randomUUID(t), 50, 0)
	require.ErrorIs(t, err, chat.ErrNotFound)

	// A user who is not a member of the chat must be rejected with
	// ErrForbidden, regardless of whether the chat exists.
	_, err = service.ListMessages(ctx, outsiderID, chatID, 50, 0)
	require.ErrorIs(t, err, chat.ErrForbidden)

	// Happy path: a member reads the seeded message.
	msgs, err := service.ListMessages(ctx, memberID, chatID, 50, 0)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Equal(t, "integration test message", msgs[0].Content)
}
