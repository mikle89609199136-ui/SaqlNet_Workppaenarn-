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
// text. Column list mirrors the NOT NULL constraints introduced by
// migrations 0001_auth.sql (username, password_hash, first_name) and
// extended by 0025_username_changes.sql (trigger auth.ensure_username_claim
// auto-populates auth.username_registry on insert).
func createTestUser(t *testing.T, db *sql.DB, username string) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(), `
		INSERT INTO auth.users (username, password_hash, first_name)
		VALUES ($1, $2, $3)
		RETURNING id::text
	`, username, "test-password-hash", "Test").Scan(&id)
	if err != nil {
		t.Fatalf("insert test user %q: %v", username, err)
	}
	return id
}

// sessionRow contains canonical metadata; current is relative to the requesting token.
type sessionRow struct {
	ID, UserID, DeviceName, DeviceType, IPAddress, Location, UserAgent string
	CreatedAt, LastActive                                              time.Time
}

type authSessionOpts struct {
	UserID          string
	AccessTokenHash string
	Revoked         bool
	ExpiresAt       time.Time
}

func createAuthSession(t *testing.T, db *sql.DB, opts authSessionOpts) string {
	t.Helper()
	if opts.ExpiresAt.IsZero() {
		opts.ExpiresAt = time.Now().Add(time.Hour)
	}
	var revokedAt sql.NullTime
	if opts.Revoked {
		revokedAt = sql.NullTime{Time: time.Now(), Valid: true}
	}
	var id string
	err := db.QueryRowContext(context.Background(), `
		INSERT INTO auth.sessions (user_id, access_token_hash, revoked_at, expires_at)
		VALUES ($1, $2, $3, $4) RETURNING id::text
	`, opts.UserID, opts.AccessTokenHash, revokedAt, opts.ExpiresAt).Scan(&id)
	if err != nil {
		t.Fatalf("insert auth session: %v", err)
	}
	return id
}

func sessionByID(t *testing.T, db *sql.DB, id string) sessionRow {
	t.Helper()
	var row sessionRow
	err := db.QueryRowContext(context.Background(), `
		SELECT id::text, user_id::text, device_name, device_type, ip_address,
		       location, user_agent, created_at, last_active
		FROM auth.sessions WHERE id = $1
	`, id).Scan(&row.ID, &row.UserID, &row.DeviceName, &row.DeviceType,
		&row.IPAddress, &row.Location, &row.UserAgent, &row.CreatedAt, &row.LastActive)
	if err != nil {
		t.Fatalf("select session %s: %v", id, err)
	}
	return row
}
