package integration

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// -----------------------------------------------------------------------------
// Database cleanup and seeding
// -----------------------------------------------------------------------------

// tablesToTruncate is the list of tables discovered once after migrations
// were applied. It is populated by TestMain and treated as read-only for the
// lifetime of the test binary.
//
// Contract: every integration test in this package starts with a clean
// database and leaves it clean. The list of tables is therefore derived from
// the schema, not from what a particular test happens to touch — any table
// that exists is considered part of the clean-state contract.
var tablesToTruncate []string

// discoverTables returns every base table in the test database, excluding
// public.schema_migrations.
//
// public.schema_migrations is deliberately skipped: it records which
// migrations have been applied and must survive across tests. Truncating it
// would make the next migrations.Run call re-apply every migration and fail
// on duplicate-key errors.
//
// Identifiers are quoted with format('%I.%I', ...) so schema-qualified names
// (e.g. "chats.chats") come back in the same form used by TRUNCATE.
func discoverTables(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT format('%I.%I', table_schema, table_name)
		FROM information_schema.tables
		WHERE table_type = 'BASE TABLE'
		  AND table_schema NOT IN ('pg_catalog', 'information_schema')
		  AND NOT (table_schema = 'public' AND table_name = 'schema_migrations')
		ORDER BY table_schema, table_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// truncateTables wipes every table discovered after migrations were applied,
// in a single atomic TRUNCATE ... CASCADE.
//
// It is registered via t.Cleanup by the top-level test function so that each
// test — regardless of what it writes — returns the database to the same
// empty state the next test expects.
//
// Table names come from information_schema and are never user input; they are
// interpolated as SQL identifiers, not bound as parameters.
func truncateTables(t *testing.T, db *sql.DB, ctx context.Context) {
	t.Helper()

	if len(tablesToTruncate) == 0 {
		t.Fatal("tablesToTruncate is empty; TestMain failed to discover tables")
	}

	// TRUNCATE over multiple tables is atomic: either every table is emptied
	// or none is. CASCADE handles FK dependencies between them.
	stmt := "TRUNCATE TABLE " + strings.Join(tablesToTruncate, ", ") + " CASCADE"
	if _, err := db.ExecContext(ctx, stmt); err != nil {
		t.Fatalf("truncate tables: %v", err)
	}
}

// seedUser inserts a minimal auth.users row and registers a t.Cleanup that
// removes it after the test. The generated username is derived from the UUID
// so it stays unique across parallel seeds within the same run.
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
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM auth.users WHERE id = $1`, userID)
	})
	return userID
}

// seedChat creates a chat and inserts one chats.members row per entry in
// memberRoles (user_id -> role). Cleanup is registered via t.Cleanup, which
// runs LIFO: the chat is removed before the users created earlier by seedUser,
// keeping foreign keys satisfied.
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
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM chats.chats WHERE id = $1`, chatID)
	})
	return chatID
}

// seedEncryptionKey inserts a placeholder crypto.chat_encryption_keys row.
// The key material is irrelevant for the tests; only its presence or absence
// is asserted after service calls.
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

// seedUserSettings inserts a per-user chat settings row with default values,
// so tests can assert that a service call removes it.
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

// seedMessage inserts a minimal messages.messages row and registers a
// t.Cleanup that removes it. Returns the new message's ID.
func seedMessage(
	t *testing.T,
	db *sql.DB,
	ctx context.Context,
	chatID, senderID, content string,
) string {
	t.Helper()
	messageID := randomUUID(t)
	_, err := db.ExecContext(ctx,
		`INSERT INTO messages.messages (id, chat_id, content, sender_id, type)
		 VALUES ($1, $2, $3, $4, 'text')`,
		messageID, chatID, content, senderID)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`DELETE FROM messages.messages WHERE id = $1`, messageID)
	})
	return messageID
}

// -----------------------------------------------------------------------------
// Assertions
// -----------------------------------------------------------------------------

// assertMemberExists asserts whether a chats.members row is present.
// The COUNT query uses require so that a SQL error aborts the test immediately
// instead of being reported as a misleading assertion failure.
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

// assertMemberCount asserts the total number of chats.members rows for a chat.
// Useful as a guard against accidental multi-row side effects of an operation.
func assertMemberCount(t *testing.T, db *sql.DB, ctx context.Context, chatID string, expected int) {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM chats.members WHERE chat_id = $1`, chatID).Scan(&count))
	assert.Equal(t, expected, count, "member count mismatch in chat %s", chatID)
}

// assertEncryptionKeyExists asserts whether a crypto.chat_encryption_keys row
// is present for the given (chat, user) pair. Used to verify that leaving a
// chat purges the member's key material.
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

// assertUserSettingsExist asserts whether a chats.user_chat_settings row
// is present for the given (chat, user) pair. Used to verify that leaving a
// chat purges the member's per-chat preferences.
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

// countMessages returns the number of messages.messages rows for the chat.
// Handy when a test only needs the row count and not a boolean assertion.
func countMessages(t *testing.T, db *sql.DB, ctx context.Context, chatID string) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatID).Scan(&n))
	return n
}

// -----------------------------------------------------------------------------
// UUIDs
// -----------------------------------------------------------------------------

// randomUUID returns a random RFC 4122 v4 UUID as a string. It is the only
// UUID generator in the package; every seed helper relies on it.
func randomUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	_, err := rand.Read(value[:])
	require.NoError(t, err)
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16],
	)
}

// -----------------------------------------------------------------------------
// WebSocket helpers
// -----------------------------------------------------------------------------

// dialWS opens a WebSocket connection to srv, using userID as the auth token.
// This matches the behaviour of the stub token verifier used by the WS tests.
func dialWS(t *testing.T, srv *httptest.Server, userID string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "?token=" + userID
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	return conn
}

// sendPing sends a ping frame. Because the server answers with pong after
// processing earlier frames, receiving a pong acts as a barrier: it proves the
// previous frame has already been handled by readPump.
func sendPing(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, conn.WriteJSON(map[string]any{
		"type": "ping",
	}))
}

// sendChatMessage sends a chat_message frame with the given chat ID and content.
func sendChatMessage(t *testing.T, conn *websocket.Conn, chatID, content string) {
	t.Helper()
	require.NoError(t, conn.WriteJSON(map[string]any{
		"type":    "chat_message",
		"chatId":  chatID,
		"content": content,
	}))
}

// readFrame reads a single JSON frame with a deadline.
func readFrame(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(3*time.Second)))
	var frame map[string]any
	require.NoError(t, conn.ReadJSON(&frame))
	return frame
}

// requireNoFrame asserts that the connection receives nothing within 300ms
// (i.e. the read times out), meaning no broadcast frame was delivered.
func requireNoFrame(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(300*time.Millisecond)))
	var frame map[string]any
	err := conn.ReadJSON(&frame)
	require.Error(t, err, "did not expect a frame, got: %v", frame)
	var netErr net.Error
	require.True(t, errors.As(err, &netErr) && netErr.Timeout(),
		"expected a network timeout, got: %v", err)
}
