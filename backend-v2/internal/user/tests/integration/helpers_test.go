//go:build integration

package integration

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/user"
)

// -----------------------------------------------------------------------------
// Database cleanup
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

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

// withCleanDB returns the shared TestDB and registers a t.Cleanup that
// truncates every discovered table after the test finishes. Every
// integration test must call it exactly once, at the top, so the next test
// starts from the same empty schema migrations left behind.
//
// The context is detached from the test's own: by the time Cleanup runs the
// test may already be failing, but truncation must still succeed.
func withCleanDB(t *testing.T) *sql.DB {
	t.Helper()
	t.Cleanup(func() {
		truncateTables(t, TestDB, context.Background())
	})
	return TestDB
}

// newService returns a user.Service backed by the given database handle.
// Passing db explicitly (rather than reading TestDB) keeps call sites honest
// about which handle they use.
func newService(db *sql.DB) *user.Service {
	return user.NewService(db)
}

// createTestUser inserts a minimal auth.users row and returns its UUID as
// text.
//
// All NOT NULL columns without DEFAULT must be supplied explicitly:
//   - username      (VARCHAR(32) NOT NULL)
//   - password_hash (TEXT NOT NULL)
//   - first_name    (VARCHAR(64) NOT NULL)
//
// last_name has DEFAULT ”, id has DEFAULT gen_random_uuid(), and the
// timestamp columns have DEFAULT NOW(), so they can be omitted.
func createTestUser(t *testing.T, db *sql.DB, username string) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(), `
		INSERT INTO auth.users (username, password_hash, first_name)
		VALUES ($1, $2, $3)
		RETURNING id::text
	`, username, "test-password-hash", username).Scan(&id)
	if err != nil {
		t.Fatalf("insert test user %q: %v", username, err)
	}
	return id
}

// sessionRow mirrors the user_sessions columns integration tests assert on.
type sessionRow struct {
	ID         string
	UserID     string
	DeviceName string
	DeviceType string
	IPAddress  string
	Location   string
	UserAgent  string
	IsCurrent  bool
}

// authSessionOpts describes the shape of an auth.sessions row that
// integration tests need. Zero values for optional fields are treated as
// SQL NULL where the schema allows it.
type authSessionOpts struct {
	UserID          string
	AccessTokenHash string
	Revoked         bool
	ExpiresAt       time.Time
	// DeviceSessionID, when non-empty, is stored as the FK link to
	// public.user_sessions. Empty means NULL.
	DeviceSessionID string
}

// createAuthSession inserts a minimal auth.sessions row and returns its
// UUID as text.
//
// The column set is limited to what RegisterDevice queries and what the
// integration tests assert on. refresh_token_hash and token_generation are
// intentionally omitted: the former is nullable after the legacy rollout,
// the latter has a default of 0.
func createAuthSession(t *testing.T, db *sql.DB, opts authSessionOpts) string {
	t.Helper()

	var revokedAt sql.NullTime
	if opts.Revoked {
		revokedAt = sql.NullTime{Time: time.Now(), Valid: true}
	}
	var accessHash sql.NullString
	if opts.AccessTokenHash != "" {
		accessHash = sql.NullString{String: opts.AccessTokenHash, Valid: true}
	}
	var deviceSess sql.NullString
	if opts.DeviceSessionID != "" {
		deviceSess = sql.NullString{String: opts.DeviceSessionID, Valid: true}
	}

	var id string
	err := db.QueryRowContext(context.Background(), `
		INSERT INTO auth.sessions
			(user_id, access_token_hash, revoked_at, expires_at, device_session_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text
	`, opts.UserID, accessHash, revokedAt, opts.ExpiresAt, deviceSess).Scan(&id)
	if err != nil {
		t.Fatalf("insert auth session: %v", err)
	}
	return id
}

// authSessionDeviceLink returns the device_session_id of an auth.sessions
// row as text, or "" when the column is NULL.
func authSessionDeviceLink(t *testing.T, db *sql.DB, authSessionID string) string {
	t.Helper()
	var link sql.NullString
	if err := db.QueryRowContext(context.Background(),
		`SELECT device_session_id::text FROM auth.sessions WHERE id = $1`,
		authSessionID,
	).Scan(&link); err != nil {
		t.Fatalf("select auth session %s: %v", authSessionID, err)
	}
	if !link.Valid {
		return ""
	}
	return link.String
}

// sessionByID fetches a single row from public.user_sessions for assertions.
// It fails the test if the row is missing.
func sessionByID(t *testing.T, db *sql.DB, id string) sessionRow {
	t.Helper()
	var row sessionRow
	err := db.QueryRowContext(context.Background(), `
		SELECT id::text, user_id::text, device_name, device_type,
		       ip_address, location, user_agent, is_current
		FROM public.user_sessions
		WHERE id = $1
	`, id).Scan(
		&row.ID, &row.UserID, &row.DeviceName, &row.DeviceType,
		&row.IPAddress, &row.Location, &row.UserAgent, &row.IsCurrent,
	)
	if err != nil {
		t.Fatalf("select session %s: %v", id, err)
	}
	return row
}

// countSessionsForUser returns the number of public.user_sessions rows for
// the given user.
func countSessionsForUser(t *testing.T, db *sql.DB, userID string) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM public.user_sessions WHERE user_id = $1`,
		userID,
	).Scan(&n); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	return n
}

// currentSessionID returns the id of the only session with is_current = TRUE
// for the user, and fails if there is not exactly one such session.
func currentSessionID(t *testing.T, db *sql.DB, userID string) string {
	t.Helper()
	var id string
	if err := db.QueryRowContext(context.Background(),
		`SELECT id::text FROM public.user_sessions
		 WHERE user_id = $1 AND is_current = TRUE`,
		userID,
	).Scan(&id); err != nil {
		t.Fatalf("select current session: %v", err)
	}

	var count int
	if err := db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM public.user_sessions
		 WHERE user_id = $1 AND is_current = TRUE`,
		userID,
	).Scan(&count); err != nil {
		t.Fatalf("count current sessions: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one current session, got %d", count)
	}
	return id
}
