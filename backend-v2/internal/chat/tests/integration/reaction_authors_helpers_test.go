//go:build integration

package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"

	"github.com/stretchr/testify/require"
)

// newChatService builds a chat.Service over the shared TestDB. The WebSocket
// hub and presence store are intentionally nil: ListReactionAuthors reads only
// from the database, and its code path never dereferences s.ws / s.presence.
func newChatService(t *testing.T) *chat.Service {
	t.Helper()
	return chat.NewService(TestDB, nil, nil)
}

// seedReaction inserts a messages.reactions row with the database default
// created_at (NOW()). The composite UNIQUE (message_id, user_id) added by the
// reaction-logic migration means one reaction per user per message; a repeated
// insert for the same (message, user) fails and is reported as a test setup
// error, which is the intent.
func seedReaction(t *testing.T, db *sql.DB, ctx context.Context, messageID, userID, emoji string) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
		messageID, userID, emoji)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
			messageID, userID)
	})
}

// seedReactionAt is seedReaction with an explicit created_at. Used by
// pagination tests to build a deterministic (created_at DESC, user_id DESC)
// ordering; tests that need equal timestamps across rows simply pass the same
// value.
func seedReactionAt(t *testing.T, db *sql.DB, ctx context.Context, messageID, userID, emoji string, createdAt time.Time) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO messages.reactions (message_id, user_id, emoji, created_at) VALUES ($1, $2, $3, $4)`,
		messageID, userID, emoji, createdAt)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
			messageID, userID)
	})
}

// seedProfile upserts a users.profiles row. Tests that need an avatar to be
// visible under "photoVisibility = all" must seed one: without it the joined
// avatar_url falls back to an empty string and privacy cannot be observed.
func seedProfile(t *testing.T, db *sql.DB, ctx context.Context, userID, firstName, lastName, avatarURL string) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO users.profiles (user_id, first_name, last_name, avatar_url)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO UPDATE
		   SET first_name = EXCLUDED.first_name,
		       last_name  = EXCLUDED.last_name,
		       avatar_url = EXCLUDED.avatar_url`,
		userID, firstName, lastName, avatarURL)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM users.profiles WHERE user_id = $1`, userID)
	})
}

// seedPrivacySettings upserts the given privacy_settings JSON into
// users.settings. Other columns of the row keep their defaults.
func seedPrivacySettings(t *testing.T, db *sql.DB, ctx context.Context, userID string, settings map[string]any) {
	t.Helper()
	raw, err := json.Marshal(settings)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx,
		`INSERT INTO users.settings (user_id, privacy_settings)
		 VALUES ($1, $2::jsonb)
		 ON CONFLICT (user_id) DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings`,
		userID, string(raw))
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM users.settings WHERE user_id = $1`, userID)
	})
}

// seedBlock inserts a users.blocked_users row: blockerID has blocked blockedID.
func seedBlock(t *testing.T, db *sql.DB, ctx context.Context, blockerID, blockedID string) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`,
		blockerID, blockedID)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM users.blocked_users WHERE user_id = $1 AND blocked_user_id = $2`,
			blockerID, blockedID)
	})
}

// seedPrivacyException inserts a users.privacy_exceptions row. rule must be one
// of the canonical keys from the privacy package (for photo, "photoVisibility").
func seedPrivacyException(t *testing.T, db *sql.DB, ctx context.Context, ownerID, userID, rule string, allow bool) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow) VALUES ($1, $2, $3, $4)`,
		ownerID, userID, rule, allow)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM users.privacy_exceptions WHERE owner_id = $1 AND user_id = $2 AND rule = $3`,
			ownerID, userID, rule)
	})
}

// seedMember adds a user to a chat with the given role. Tests that seed a
// reaction for a "third party" use this so the fixture mirrors what the API
// would allow: only members can react to a message.
func seedMember(t *testing.T, db *sql.DB, ctx context.Context, chatID, userID, role string) {
	t.Helper()
	_, err := db.ExecContext(ctx,
		`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, $3)`,
		chatID, userID, role)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`,
			chatID, userID)
	})
}

// setupReactionFixture returns a service, a private chat with two members
// (owner, peer) and one message sent by the owner. Each call registers a
// truncateTables cleanup, so every test that uses the fixture starts and ends
// with a clean database regardless of what previous tests did.
func setupReactionFixture(t *testing.T) (svc *chat.Service, ownerID, peerID, chatID, messageID string, ctx context.Context) {
	t.Helper()
	t.Cleanup(func() {
		truncateTables(t, TestDB, context.Background())
	})

	ctx = context.Background()
	svc = newChatService(t)
	ownerID = seedUser(t, TestDB, ctx)
	peerID = seedUser(t, TestDB, ctx)
	chatID = seedChat(t, TestDB, ctx, "private", ownerID, map[string]string{
		ownerID: "owner",
		peerID:  "member",
	})
	messageID = seedMessage(t, TestDB, ctx, chatID, ownerID, "hello")
	return svc, ownerID, peerID, chatID, messageID, ctx
}
