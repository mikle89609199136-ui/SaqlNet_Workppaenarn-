package authctx

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
)

// DBTokenChecker checks token revocation against auth.revoked_tokens.
// Any Go service with a DB pool can use this to participate in token revocation.
type DBTokenChecker struct {
	db *sql.DB
}

func NewDBTokenChecker(db *sql.DB) *DBTokenChecker {
	return &DBTokenChecker{db: db}
}

func (c *DBTokenChecker) IsTokenRevoked(ctx context.Context, token string) bool {
	h := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(h[:])
	var dummy int
	err := c.db.QueryRowContext(ctx,
		`SELECT 1 FROM auth.revoked_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
		hash,
	).Scan(&dummy)
	return err == nil
}
