//go:build integration

package integration

import (
	"context"
	"testing"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/require"
)

// TestSendMessageRejectsReplyFromAnotherChat covers the contract that a
// reply_to reference must point to a message inside the same chat. Attempting
// to send a message in chat B with ReplyTo pointing to a message in chat A
// must be rejected with ErrNotFound (mapped to 404 at the HTTP layer), and
// must not persist anything in chat B.
//
// Uses the shared TestDB from TestMain. The two chats and three users are
// seeded here so the test can run in any order relative to the rest of the
// package; t.Cleanup wipes all mutable state afterwards.
func TestSendMessageRejectsReplyFromAnotherChat(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	service := chat.NewService(db, nil, nil)

	t.Cleanup(func() {
		truncateTables(t, db, context.Background())
	})

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

	// The message being replied to lives in chat A, but the reply will be
	// sent into chat B — cross-chat reference must be refused.
	replyID := seedMessage(t, db, ctx, chatAID, memberID, "private message in Chat A")

	var before int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatBID).Scan(&before))

	_, err := service.SendMessages(ctx, senderID, chatBID, []chat.OutgoingMessage{
		{
			Content: "cross-chat reply",
			Type:    "text",
			ReplyTo: &replyID,
		},
	})
	require.ErrorIs(t, err, chat.ErrNotFound,
		"expected ErrNotFound, got %v", err)

	var after int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatBID).Scan(&after))
	require.Equal(t, before, after,
		"invalid reply must not create a message in chat B")
}
