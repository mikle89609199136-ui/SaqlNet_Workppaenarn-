package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/chat"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"

	"github.com/stretchr/testify/require"
)

// stubTokenVerifier accepts any token and treats it as the userID.
// Crypto validation is not the seam under test in this file.
type stubTokenVerifier struct{}

func (stubTokenVerifier) VerifyToken(_ context.Context, token string) (cryptoclient.TokenClaims, error) {
	return cryptoclient.TokenClaims{Subject: token}, nil
}

// TestWSChatMessage_Unsupported covers the regression contract CHAT-B011:
// the incoming chat_message command is no longer supported by the server and
// is ignored in readPump.
//
// Invariants:
//  1. The message is not persisted in messages.messages (the chat stays empty).
//  2. No broadcast frame is sent to other members (the owner sees a timeout in
//     requireNoFrame).
//  3. The sender receives no chat_message_error or any other frame except the
//     pong reply to the ping.
//
// Determinism: after sending chat_message the client sends a ping; receiving
// pong proves the previous frame has already been read and processed by
// readPump, removing the race between the client's DB check and the server.
//
// Uses the shared TestDB from TestMain; no per-test container is started.
func TestWSChatMessage_Unsupported(t *testing.T) {
	ctx := context.Background()
	db := TestDB

	t.Cleanup(func() {
		truncateTables(t, db, context.Background())
	})

	ownerID := seedUser(t, db, ctx)
	memberID := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "group", ownerID, map[string]string{
		ownerID:  "owner",
		memberID: "member",
	})

	ws := chat.NewWSServer(db, stubTokenVerifier{}, nil)
	srv := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	t.Cleanup(srv.Close)

	owner := dialWS(t, srv, ownerID)
	member := dialWS(t, srv, memberID)
	t.Cleanup(func() {
		_ = owner.Close()
	})
	t.Cleanup(func() {
		_ = member.Close()
	})

	sendChatMessage(t, member, chatID, "ws-unsupported-payload")
	sendPing(t, member)

	pongFrame := readFrame(t, member)
	require.Equal(t, "pong", pongFrame["type"],
		"expected a pong reply to ping, confirming the previous frame was processed")

	requireNoFrame(t, owner)
	require.Equal(t, 0, countMessages(t, db, ctx, chatID),
		"chat_message must not be persisted to the database")
}
