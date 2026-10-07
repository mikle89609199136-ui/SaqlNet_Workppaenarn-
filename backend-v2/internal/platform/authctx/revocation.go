package authctx

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
)

// DBTokenChecker checks both exact-token revocations and the user's current
// logout-all generation.
// Any Go service with a DB pool can use this to participate in token revocation.
type DBTokenChecker struct {
	db *sql.DB
}

func NewDBTokenChecker(db *sql.DB) *DBTokenChecker {
	return &DBTokenChecker{db: db}
}

// TokenHash returns the stable, non-reversible token fingerprint used to join
// credential lifecycle records without storing bearer tokens in PostgreSQL.
func TokenHash(value string) string {
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}

func (c *DBTokenChecker) IsTokenRevoked(ctx context.Context, token string, claims cryptoclient.TokenClaims) (bool, error) {
	if c == nil || c.db == nil {
		return false, errors.New("token revocation database is unavailable")
	}
	var individuallyRevoked bool
	var currentGeneration int64
	err := c.db.QueryRowContext(ctx,
		`SELECT
			EXISTS (
				SELECT 1
				FROM auth.revoked_tokens
				WHERE token_hash = $1 AND expires_at > NOW()
			),
			token_generation
		FROM auth.users
		WHERE id = $2`,
		TokenHash(token),
		claims.Subject,
	).Scan(&individuallyRevoked, &currentGeneration)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return individuallyRevoked || currentGeneration != claims.TokenGeneration, nil
}
