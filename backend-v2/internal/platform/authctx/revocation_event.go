package authctx

import (
	"context"
	"database/sql"
	"encoding/json"
)

const RevocationChannel = "auth_token_revoked"

// RevocationEvent carries only a fingerprint or a committed generation, never
// a bearer token. Generation preserves logins issued after logout-all.
type RevocationEvent struct {
	UserID     string `json:"userId"`
	TokenHash  string `json:"tokenHash,omitempty"`
	Generation *int64 `json:"generation,omitempty"`
}

// NotifyRevocation is part of the revocation transaction. PostgreSQL delivers
// the event to every listener only on commit, and discards it on rollback.
func NotifyRevocation(ctx context.Context, tx *sql.Tx, event RevocationEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `SELECT pg_notify($1, $2)`, RevocationChannel, string(payload))
	return err
}
