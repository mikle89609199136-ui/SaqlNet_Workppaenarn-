package authctx

import (
	"context"
	"database/sql"
	"errors"
)

var ErrTokenGenerationSchemaNotReady = errors.New("auth token generation schema is not ready")

// CheckTokenGenerationSchema verifies the schema required by DBTokenChecker.
// Readiness probes use it to keep new replicas out of service until migration
// 0025 has completed.
func CheckTokenGenerationSchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return ErrTokenGenerationSchemaNotReady
	}

	var ready bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'auth'
			  AND table_name = 'users'
			  AND column_name = 'token_generation'
			  AND data_type = 'bigint'
			  AND is_nullable = 'NO'
			  AND column_default IS NOT NULL
		)
	`).Scan(&ready)
	if err != nil {
		return err
	}
	if !ready {
		return ErrTokenGenerationSchemaNotReady
	}
	return nil
}
