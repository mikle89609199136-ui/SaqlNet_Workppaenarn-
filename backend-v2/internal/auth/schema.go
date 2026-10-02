package auth

import (
	"context"
	"database/sql"
	"errors"
)

var ErrSessionSchemaNotReady = errors.New("auth session schema is not ready")

// CheckSessionSchema keeps a new auth replica out of service until migration
// 0035 is present. Without it, token issuance would succeed in crypto and then
// fail while recording the corresponding login session.
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
