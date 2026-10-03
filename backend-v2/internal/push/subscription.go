// Package push — Web Push уведомления (#717): подписки устройств и
// доставка сообщений и звонков.
//
// Текста сообщений здесь нет и быть не может: сервер его не видит
// (сквозное шифрование). В push уходят имя отправителя, название и тип
// чата, вид события — ровно то, что сервер и так знает. Содержимое push
// шифруется до браузера (RFC 8291): push-сервисы Apple, Google, Mozilla и
// Microsoft его не читают.
package push

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/url"
	"strings"
)

// ErrInvalidSubscription — подписка не прошла проверку.
var ErrInvalidSubscription = errors.New("invalid push subscription")

// MaxSubscriptionsPerUser — больше устройств у одного человека не бывает:
// старые подписки вытесняются новыми.
const MaxSubscriptionsPerUser = 20

const maxEndpointLength = 2048

// Сервер сам отправляет POST на адрес подписки, поэтому адрес — только
// https и только известного push-сервиса: иначе через подписку можно было
// бы заставить сервер ходить во внутреннюю сеть (SSRF).
var allowedPushHosts = []string{
	"fcm.googleapis.com",
	"android.googleapis.com",
	".push.services.mozilla.com",
	".push.apple.com",
	".notify.windows.com",
}

// Subscription — подписка устройства, как её отдаёт PushManager.subscribe.
type Subscription struct {
	Endpoint string `json:"endpoint"`
	Keys     Keys   `json:"keys"`
}

type Keys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

func allowedHost(host string) bool {
	host = strings.ToLower(host)
	for _, allowed := range allowedPushHosts {
		if strings.HasPrefix(allowed, ".") {
			if strings.HasSuffix(host, allowed) && len(host) > len(allowed) {
				return true
			}
		} else if host == allowed {
			return true
		}
	}
	return false
}

func decodeKey(value string) ([]byte, error) {
	value = strings.TrimRight(value, "=")
	if decoded, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	return base64.RawStdEncoding.DecodeString(value)
}

// Validate проверяет подписку до записи и до любой отправки.
func (s Subscription) Validate() error {
	if s.Endpoint == "" || len(s.Endpoint) > maxEndpointLength {
		return ErrInvalidSubscription
	}
	endpoint, err := url.Parse(s.Endpoint)
	if err != nil || endpoint.Scheme != "https" || endpoint.User != nil || endpoint.Port() != "" {
		return ErrInvalidSubscription
	}
	if !allowedHost(endpoint.Hostname()) {
		return ErrInvalidSubscription
	}
	p256dh, err := decodeKey(s.Keys.P256dh)
	if err != nil || len(p256dh) != 65 || p256dh[0] != 0x04 {
		return ErrInvalidSubscription
	}
	auth, err := decodeKey(s.Keys.Auth)
	if err != nil || len(auth) != 16 {
		return ErrInvalidSubscription
	}
	return nil
}

// Save записывает подписку устройства и возвращает её id. Тот же endpoint
// у другого человека (вошли в другой аккаунт на том же устройстве) —
// переходит к нему: устройство одно, уведомления должны идти текущему.
func Save(ctx context.Context, db *sql.DB, userID string, sub Subscription) (string, error) {
	if err := sub.Validate(); err != nil {
		return "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()

	var id string
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO users.push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE
		SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = NOW()
		RETURNING id::text
	`, userID, sub.Endpoint, sub.Keys.P256dh, sub.Keys.Auth).Scan(&id); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM users.push_subscriptions
		WHERE user_id = $1 AND id NOT IN (
			SELECT id FROM users.push_subscriptions
			WHERE user_id = $1
			ORDER BY updated_at DESC, id
			LIMIT $2
		)
	`, userID, MaxSubscriptionsPerUser); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

// Delete удаляет подписку своего устройства. Чужую — нельзя: endpoint
// сверяется вместе с владельцем.
func Delete(ctx context.Context, db *sql.DB, userID, endpoint string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM users.push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint)
	return err
}
