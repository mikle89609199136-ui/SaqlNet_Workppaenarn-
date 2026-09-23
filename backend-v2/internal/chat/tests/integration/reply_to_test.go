package integration

import (
	"context"
	"errors"
	"testing"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/require"
)

// TestSendMessageRejectsReplyFromAnotherChat verifies that SendMessage refuses
// a reply whose target message belongs to a different chat. The reply-to ID is
// scoped per chat: resolving it must fail with ErrNotFound for a cross-chat
// reference, and no message must be created in the target chat.
//
// Uses the shared TestDB from TestMain; no per-test container is started.
func TestSendMessageRejectsReplyFromAnotherChat(t *testing.T) {
	ctx := context.Background()
	db := TestDB

	t.Cleanup(func() {
		truncateTables(t, db, context.Background())
	})

	// Three users: sender participates in both chats, member only in A,
	// outsider only in B. This makes the cross-chat reference meaningful.
	senderID := seedUser(t, db, ctx)
	memberID := seedUser(t, db, ctx)
	outsiderID := seedUser(t, db, ctx)

	chatAID := seedChat(t, db, ctx, "group", senderID, map[string]string{
		senderID: "owner",
		memberID: "member",
	})
	chatBID := seedChat(t, db, ctx, "group", senderID, map[string]string{
		senderID:   "owner",
		outsiderID: "member",
	})

	// The target of the reply lives in Chat A; the attempted reply is sent to
	// Chat B, so the service must reject it.
	replyID := seedMessage(t, db, ctx, chatAID, memberID, "private message in Chat A")

	before := countMessages(t, db, ctx, chatBID)

	_, err := chat.NewService(db, nil, nil).SendMessage(
		ctx, senderID, chatBID, "cross-chat reply", "text", &replyID, nil,
	)
	require.True(t, errors.Is(err, chat.ErrNotFound),
		"expected ErrNotFound, got %v", err)

	after := countMessages(t, db, ctx, chatBID)
	require.Equal(t, before, after,
		"invalid reply must not create a message in Chat B")
}
