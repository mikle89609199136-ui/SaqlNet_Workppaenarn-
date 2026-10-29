//go:build integration

package auth_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestTwoFAHashConstraintRejectsInvalidWrites(t *testing.T) {
	db := dbtest.Postgres(t)
	const id = "11111111-0411-4411-8411-111111111111"
	dbtest.User(t, db, id, "two_fa_user")
	for _, hash := range []any{nil, "", " \t\n"} {
		_, err := db.Exec("UPDATE auth.users SET two_fa_enabled=true,two_fa_hash=$1 WHERE id=$2", hash, id)
		var pg *pq.Error
		require.ErrorAs(t, err, &pg)
		require.Equal(t, pq.ErrorCode("23514"), pg.Code)
	}
	_, err := db.Exec("UPDATE auth.users SET two_fa_enabled=true,two_fa_hash='valid-hash' WHERE id=$1", id)
	require.NoError(t, err)
	_, err = db.Exec("UPDATE auth.users SET two_fa_hash=NULL WHERE id=$1", id)
	require.Error(t, err)
	// Disabling clears both fields in one statement and remains valid.
	_, err = db.Exec("UPDATE auth.users SET two_fa_enabled=false,two_fa_hash=NULL WHERE id=$1", id)
	require.NoError(t, err)
	var validated bool
	require.NoError(t, db.QueryRow("SELECT convalidated FROM pg_constraint WHERE conrelid='auth.users'::regclass AND conname='auth_users_enabled_two_fa_hash'").Scan(&validated))
	require.True(t, validated)
}

func TestTwoFAHashMigrationPreservesAndRejectsLegacyCorruption(t *testing.T) {
	db := dbtest.Postgres(t)
	// Recreate the pre-migration corruption only in this isolated test database.
	_, err := db.Exec("ALTER TABLE auth.users DROP CONSTRAINT auth_users_enabled_two_fa_hash")
	require.NoError(t, err)
	for i, hash := range []any{nil, "", " \t\n"} {
		id := fmt.Sprintf("11111111-0411-4411-8411-%012d", i+1)
		dbtest.User(t, db, id, fmt.Sprintf("legacy_%d", i))
		_, err = db.Exec("UPDATE auth.users SET two_fa_enabled=true,two_fa_hash=$1 WHERE id=$2", hash, id)
		require.NoError(t, err)
	}
	migration, err := os.ReadFile("../../migrations/0047_auth_two_fa_hash.sql")
	require.NoError(t, err)
	for range 2 {
		_, err = db.Exec(string(migration))
		require.NoError(t, err)
	}
	var validated bool
	require.NoError(t, db.QueryRow("SELECT convalidated FROM pg_constraint WHERE conrelid='auth.users'::regclass AND conname='auth_users_enabled_two_fa_hash'").Scan(&validated))
	require.False(t, validated)
	issues := 0
	service := auth.NewService(db, &mockCrypto{
		verifyFunc: func(context.Context, string, string) (bool, error) { return true, nil },
		issueTokenFunc: func(context.Context, string, string, int64) (string, error) {
			issues++
			return "must-not-be-issued", nil
		},
	})
	for i, hash := range []any{nil, "", " \t\n"} {
		id := fmt.Sprintf("11111111-0411-4411-8411-%012d", i+1)
		var enabled bool
		var stored sql.NullString
		require.NoError(t, db.QueryRow("SELECT two_fa_enabled,two_fa_hash FROM auth.users WHERE id=$1", id).Scan(&enabled, &stored))
		require.True(t, enabled)
		if hash == nil {
			require.False(t, stored.Valid)
		} else {
			require.Equal(t, hash, stored.String)
		}
		_, token, err := service.Login(t.Context(), fmt.Sprintf("legacy_%d", i), "primary", "anything")
		require.ErrorIs(t, err, auth.ErrInvalidTwoFAState)
		require.Empty(t, token)
	}
	require.Zero(t, issues)
	var sessions int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM auth.sessions").Scan(&sessions))
	require.Zero(t, sessions)
	// A NOT VALID check still rejects new inconsistent writes.
	dbtest.User(t, db, "11111111-0411-4411-8411-999999999999", "new_user")
	_, err = db.Exec("UPDATE auth.users SET two_fa_enabled=true WHERE username='new_user'")
	require.Error(t, err)
	// After explicit repair, the same repeatable migration validates the check.
	_, err = db.Exec("UPDATE auth.users SET two_fa_hash='repaired-hash' WHERE two_fa_enabled")
	require.NoError(t, err)
	_, err = db.Exec(string(migration))
	require.NoError(t, err)
	require.NoError(t, db.QueryRow("SELECT convalidated FROM pg_constraint WHERE conrelid='auth.users'::regclass AND conname='auth_users_enabled_two_fa_hash'").Scan(&validated))
	require.True(t, validated)
}
