package privacy

import (
	"context"
	"database/sql"

	"github.com/lib/pq"
)

// AllowedMany — для каждого владельца из ownerIDs: можно ли зрителю то, что
// закрывает правило. Один запрос на весь список: поиск, участники группы,
// история сообщений (#789). Владельца, которого нет в базе, в ответе нет —
// вызывающий считает это запретом.
func AllowedMany(ctx context.Context, db *sql.DB, ownerIDs []string, viewerID string, rule Rule) (map[string]bool, error) {
	allowed := make(map[string]bool, len(ownerIDs))
	if len(ownerIDs) == 0 {
		return allowed, nil
	}
	rows, err := db.QueryContext(ctx, `
		SELECT u.id::text, s.privacy_settings,
		       EXISTS(SELECT 1 FROM users.blocked_users b WHERE b.user_id = u.id AND b.blocked_user_id = $2::uuid),
		       (SELECT jsonb_object_agg(e.rule, e.allow) FROM users.privacy_exceptions e WHERE e.owner_id = u.id AND e.user_id = $2::uuid)
		FROM auth.users u
		LEFT JOIN users.settings s ON s.user_id = u.id
		WHERE u.id = ANY($1::uuid[])`, pq.Array(ownerIDs), viewerID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id string
		var settings, exceptions []byte
		var blocked bool
		if err := rows.Scan(&id, &settings, &blocked, &exceptions); err != nil {
			return nil, err
		}
		relation := Relation{Self: id == viewerID, Blocked: blocked, Exceptions: ParseExceptions(exceptions)}
		allowed[id] = Decide(Parse(settings), relation, rule)
	}
	return allowed, rows.Err()
}

// PhotoSlot — чей аватар и где он лежит в ответе.
type PhotoSlot struct {
	OwnerID string
	URL     *string
}

// HidePhotos очищает аватары, которые правило «Фото» закрывает от зрителя
// (#789): с блокировкой и исключениями, как везде. Пустые и свои не
// проверяются, так что список без аватаров не стоит ни одного запроса.
func HidePhotos(ctx context.Context, db *sql.DB, viewerID string, slots []PhotoSlot) error {
	var owners []string
	seen := make(map[string]bool)
	for _, slot := range slots {
		if slot.URL == nil || *slot.URL == "" || slot.OwnerID == viewerID || seen[slot.OwnerID] {
			continue
		}
		seen[slot.OwnerID] = true
		owners = append(owners, slot.OwnerID)
	}
	if len(owners) == 0 {
		return nil
	}
	allowed, err := AllowedMany(ctx, db, owners, viewerID, Photo)
	if err != nil {
		return err
	}
	for _, slot := range slots {
		if slot.URL != nil && *slot.URL != "" && slot.OwnerID != viewerID && !allowed[slot.OwnerID] {
			*slot.URL = ""
		}
	}
	return nil
}
