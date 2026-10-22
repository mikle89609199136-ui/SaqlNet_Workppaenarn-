package push

import (
	"context"
	"database/sql"

	"craneapp/backend-v2/internal/platform/notificationpolicy"

	"github.com/lib/pq"
)

// DBDirectory — Directory поверх общей базы.
type DBDirectory struct {
	DB *sql.DB
}

func (d DBDirectory) ChatInfo(ctx context.Context, chatID string) (ChatInfo, error) {
	var info ChatInfo
	err := d.DB.QueryRowContext(ctx, `SELECT type, COALESCE(title, '') FROM chats.chats WHERE id = $1`, chatID).
		Scan(&info.Type, &info.Title)
	return info, err
}

func (d DBDirectory) DisplayName(ctx context.Context, userID string) (string, error) {
	var name string
	err := d.DB.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(up.first_name, ''), NULLIF(au.first_name, ''), au.username, '')
		FROM auth.users au
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE au.id = $1
	`, userID).Scan(&name)
	return name, err
}

func (d DBDirectory) IsMember(ctx context.Context, chatID, userID string) (bool, error) {
	var member bool
	err := d.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chats.members WHERE chat_id = $1 AND user_id = $2)`, chatID, userID).
		Scan(&member)
	return member, err
}

func (d DBDirectory) MembersExcept(ctx context.Context, chatID, userID string) ([]string, error) {
	rows, err := d.DB.QueryContext(ctx, `SELECT user_id::text FROM chats.members WHERE chat_id = $1 AND user_id <> $2`, chatID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var members []string
	for rows.Next() {
		var member string
		if err := rows.Scan(&member); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

// Targets — подписки получателей. Выключил уведомления в настройках — его
// подписок здесь нет; нет строки настроек — уведомления по умолчанию
// включены, язык — русский. Personal mute фильтрует только message этого
// чата, на всех устройствах; calls/missed_call от него не зависят (#559).
func (d DBDirectory) Targets(ctx context.Context, userIDs []string, event Event) ([]Target, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	rows, err := d.DB.QueryContext(ctx, `
		SELECT ps.id::text, ps.user_id::text, ps.endpoint, ps.p256dh, ps.auth,
		       COALESCE(us.settings->>'language', 'ru'), us.settings
		FROM users.push_subscriptions ps
		LEFT JOIN users.settings us ON us.user_id = ps.user_id
		WHERE ps.user_id = ANY($1::uuid[])
		  AND ($3 <> 'message' OR NOT EXISTS (
		    SELECT 1 FROM chats.user_chat_settings cs
		    WHERE cs.user_id=ps.user_id AND cs.chat_id=$2::uuid
		      AND cs.notifications_muted_at IS NOT NULL
		      AND (cs.notifications_muted_until IS NULL OR cs.notifications_muted_until > NOW())
		  ))
	`, pq.Array(userIDs), event.ChatID, event.Kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var targets []Target
	for rows.Next() {
		var target Target
		var rawSettings []byte
		if err := rows.Scan(&target.SubscriptionID, &target.UserID, &target.Subscription.Endpoint,
			&target.Subscription.Keys.P256dh, &target.Subscription.Keys.Auth, &target.Lang, &rawSettings); err != nil {
			return nil, err
		}
		flags := notificationpolicy.Read(rawSettings)
		if !flags.Notifications {
			continue
		}
		target.Silent = true
		switch event.Kind {
		case KindMessage:
			target.Silent = !flags.Sounds
		case KindCall:
			target.Silent = !flags.CallSounds
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func (d DBDirectory) DeleteSubscription(ctx context.Context, subscriptionID string) error {
	_, err := d.DB.ExecContext(ctx, `DELETE FROM users.push_subscriptions WHERE id = $1`, subscriptionID)
	return err
}
