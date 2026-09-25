package privacy

import (
	"context"
	"database/sql"
	"errors"
)

// Load читает настройки владельца и его отношение к зрителю одним запросом.
func Load(ctx context.Context, db *sql.DB, ownerID, viewerID string) (Settings, Relation, error) {
	if ownerID == viewerID {
		return Settings{}, Relation{Self: true}, nil
	}
	var raw []byte
	var blocked bool
	err := db.QueryRowContext(ctx, `
		SELECT settings.privacy_settings,
		       EXISTS(SELECT 1 FROM users.blocked_users b WHERE b.user_id = $1 AND b.blocked_user_id = $2)
		FROM auth.users
		LEFT JOIN users.settings AS settings ON settings.user_id = auth.users.id
		WHERE auth.users.id = $1`, ownerID, viewerID).Scan(&raw, &blocked)
	if errors.Is(err, sql.ErrNoRows) {
		// Владельца нет — показывать нечего.
		return Closed(), Relation{Blocked: true}, nil
	}
	if err != nil {
		return Settings{}, Relation{}, err
	}
	return Parse(raw), Relation{Blocked: blocked}, nil
}

// Allowed — можно ли зрителю то, что закрывает правило владельца.
func Allowed(ctx context.Context, db *sql.DB, ownerID, viewerID string, rule Rule) (bool, error) {
	settings, rel, err := Load(ctx, db, ownerID, viewerID)
	if err != nil {
		return false, err
	}
	return Decide(settings, rel, rule), nil
}
