package auth

import (
	"context"
	"database/sql"
	"errors"
)

var ErrSessionSchemaNotReady = errors.New("auth session schema is not ready")

// CheckSessionSchema keeps new auth and user replicas out of service until the
// canonical session metadata schema is present. Without it, token
// issuance or scoped device logout would fail after a mixed-version rollout.
func CheckSessionSchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return ErrSessionSchemaNotReady
	}

	var ready bool
	err := db.QueryRowContext(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'auth' AND table_name = 'sessions'
					AND column_name = 'access_token_hash' AND data_type = 'text'
			) AND
			EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'auth' AND table_name = 'sessions'
					AND column_name = 'token_generation' AND data_type = 'bigint'
					AND is_nullable = 'NO' AND column_default IS NOT NULL
			) AND
			EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'auth' AND table_name = 'sessions'
					AND column_name = 'refresh_token_hash' AND is_nullable = 'YES'
			) AND
			EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'auth' AND table_name = 'sessions'
					AND column_name = 'user_agent' AND data_type = 'text'
			) AND
			EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'auth' AND table_name = 'sessions'
					AND column_name = 'location' AND data_type = 'text'
			)
	`).Scan(&ready)
	if err != nil {
		return err
	}
	if !ready {
		return ErrSessionSchemaNotReady
	}
	return nil
}
