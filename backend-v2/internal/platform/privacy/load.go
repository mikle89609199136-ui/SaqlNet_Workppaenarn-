package privacy

import (
	"context"
	"database/sql"
	"errors"
)

// Load читает настройки владельца и его отношение к зрителю одним запросом:
// блокировку и исключения (#784).
func Load(ctx context.Context, db *sql.DB, ownerID, viewerID string) (Settings, Relation, error) {
	if ownerID == viewerID {
		return Settings{}, Relation{Self: true}, nil
	}
	var raw, exceptions []byte
	var blocked bool
	err := db.QueryRowContext(ctx, `
		SELECT settings.privacy_settings,
		       EXISTS(SELECT 1 FROM users.blocked_users b WHERE b.user_id = $1 AND b.blocked_user_id = $2),
		       (SELECT jsonb_object_agg(e.rule, e.allow) FROM users.privacy_exceptions e WHERE e.owner_id = $1 AND e.user_id = $2)
		FROM auth.users
		LEFT JOIN users.settings AS settings ON settings.user_id = auth.users.id
		WHERE auth.users.id = $1`, ownerID, viewerID).Scan(&raw, &blocked, &exceptions)
	if errors.Is(err, sql.ErrNoRows) {
		// Владельца нет — показывать нечего.
		return Closed(), Relation{Blocked: true}, nil
	}
	if err != nil {
		return Settings{}, Relation{}, err
	}
	return Parse(raw), Relation{Blocked: blocked, Exceptions: ParseExceptions(exceptions)}, nil
}

// Allowed — можно ли зрителю то, что закрывает правило владельца.
func Allowed(ctx context.Context, db *sql.DB, ownerID, viewerID string, rule Rule) (bool, error) {
	settings, rel, err := Load(ctx, db, ownerID, viewerID)
	if err != nil {
		return false, err
	}
	return Decide(settings, rel, rule), nil
}
