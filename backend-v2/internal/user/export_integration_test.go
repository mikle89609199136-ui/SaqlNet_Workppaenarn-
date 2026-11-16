//go:build integration

package user

import (
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/db/dbtest"

	"github.com/stretchr/testify/require"
)

// TestExportOnRealSchema seeds a real PostgreSQL schema and asserts the parts
// of the export that mocks cannot cover: sender scoping of messages,
// soft-delete filtering, ordering by created_at and uploader scoping of media.
func TestExportOnRealSchema(t *testing.T) {
	db := dbtest.Postgres(t)
	ctx := t.Context()

	const (
		owner = "78000000-0000-4000-8000-000000000001"
		peer  = "78000000-0000-4000-8000-000000000002"
	)
	dbtest.User(t, db, owner, "export_owner")
	dbtest.User(t, db, peer, "export_peer")

	var chatID string
	require.NoError(t, db.QueryRowContext(ctx, `
		INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'Export test', $1) RETURNING id::text
	`, owner).Scan(&chatID))
	for _, member := range []string{owner, peer} {
		_, err := db.ExecContext(ctx, `INSERT INTO chats.members (chat_id, user_id) VALUES ($1, $2)`, chatID, member)
		require.NoError(t, err)
	}

	insertMessage := func(sender, content string, createdAt time.Time) string {
		var id string
		require.NoError(t, db.QueryRowContext(ctx, `
			INSERT INTO messages.messages (chat_id, sender_id, content, created_at)
			VALUES ($1, $2, $3, $4) RETURNING id::text
		`, chatID, sender, content, createdAt).Scan(&id))
		return id
	}
	m1 := insertMessage(owner, "first", time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC))
	m2 := insertMessage(owner, "second", time.Date(2026, 1, 2, 10, 0, 0, 0, time.UTC))
	m3 := insertMessage(peer, "peer message", time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC))

	var m4 string
	require.NoError(t, db.QueryRowContext(ctx, `
		INSERT INTO messages.messages (chat_id, sender_id, content, created_at, deleted_at)
		VALUES ($1, $2, $3, $4, NOW()) RETURNING id::text
	`, chatID, owner, "deleted", time.Date(2026, 1, 3, 10, 0, 0, 0, time.UTC)).Scan(&m4))

	insertMedia := func(uploader, objectKey, filename string, size int64) string {
		var id string
		require.NoError(t, db.QueryRowContext(ctx, `
			INSERT INTO media.uploads (uploader_id, object_key, filename, content_type, size_bytes, created_at)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text
		`, uploader, objectKey, filename, "application/pdf", size,
			time.Date(2026, 1, 4, 10, 0, 0, 0, time.UTC)).Scan(&id))
		return id
	}
	mediaOwner := insertMedia(owner, "export/owner.pdf", "owner.pdf", 111)
	_ = insertMedia(peer, "export/peer.pdf", "peer.pdf", 222)

	_, err := db.ExecContext(ctx,
		`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, owner, peer)
	require.NoError(t, err)

	data, err := NewService(db).Export(ctx, owner, "")
	require.NoError(t, err)

	require.Len(t, data.Messages, 2)
	require.Equal(t, m1, data.Messages[0].ID)
	require.Equal(t, m2, data.Messages[1].ID)
	require.Equal(t, "first", data.Messages[0].Content)
	for _, msg := range data.Messages {
		require.NotEqual(t, m3, msg.ID, "messages from other senders must not be exported")
		require.NotEqual(t, m4, msg.ID, "soft-deleted messages must not be exported")
	}

	require.Len(t, data.Chats, 1)
	require.Equal(t, chatID, data.Chats[0].ID)

	require.Len(t, data.Media, 1)
	require.Equal(t, mediaOwner, data.Media[0].ID)
	require.Equal(t, "owner.pdf", data.Media[0].Filename)
	require.Equal(t, int64(111), data.Media[0].SizeBytes)

	require.Len(t, data.Blocked, 1)
	require.Equal(t, peer, data.Blocked[0].ID)

	require.NotNil(t, data.Devices)
	require.Empty(t, data.Devices)

	require.Equal(t, 2, data.SchemaVersion)
	require.False(t, data.Settings.PasscodeEnabled)
	require.NotNil(t, data.Settings.PrivacySettings)
	require.NotNil(t, data.Privacy)

	_, err = time.Parse(time.RFC3339, data.ExportedAt)
	require.NoError(t, err)
}
