//go:build integration

package push

import (
	"context"
	"fmt"
	"sort"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Подписки и получатели push на настоящей схеме (#717).
func TestPushOnRealSchema(t *testing.T) {
	const (
		igor  = "aaaaaaaa-1111-4111-8111-111111111111"
		masha = "bbbbbbbb-2222-4222-8222-222222222222"
		oleg  = "cccccccc-3333-4333-8333-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, igor, "push_igor")
	dbtest.User(t, db, masha, "push_masha")
	dbtest.User(t, db, oleg, "push_oleg")
	_, err := db.Exec(`INSERT INTO users.profiles (user_id, first_name) VALUES ($1, 'Игорь')`, igor)
	require.NoError(t, err)

	var chatID string
	require.NoError(t, db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'Команда', $1) RETURNING id::text`, igor).Scan(&chatID))
	for _, member := range []string{igor, masha, oleg} {
		_, err := db.Exec(`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, 'member')`, chatID, member)
		require.NoError(t, err)
	}

	sub := func(device string) Subscription {
		return Subscription{Endpoint: "https://fcm.googleapis.com/fcm/send/" + device, Keys: validKeys()}
	}
	directory := DBDirectory{DB: db}

	t.Run("подписка записывается, повтор не плодит строк", func(t *testing.T) {
		first, err := Save(ctx, db, masha, sub("masha-phone"))
		require.NoError(t, err)
		again, err := Save(ctx, db, masha, sub("masha-phone"))
		require.NoError(t, err)
		require.Equal(t, first, again)
	})

	t.Run("то же устройство, другой аккаунт — подписка переходит", func(t *testing.T) {
		_, err := Save(ctx, db, oleg, sub("shared-device"))
		require.NoError(t, err)
		_, err = Save(ctx, db, igor, sub("shared-device"))
		require.NoError(t, err)
		var owner string
		require.NoError(t, db.QueryRow(`SELECT user_id::text FROM users.push_subscriptions WHERE endpoint = $1`, sub("shared-device").Endpoint).Scan(&owner))
		require.Equal(t, igor, owner)
	})

	t.Run("чужую подписку удалить нельзя", func(t *testing.T) {
		require.NoError(t, Delete(ctx, db, oleg, sub("masha-phone").Endpoint))
		targets, err := directory.Targets(ctx, []string{masha})
		require.NoError(t, err)
		require.Len(t, targets, 1)
	})

	t.Run("больше предела устройств — старые вытесняются", func(t *testing.T) {
		for i := 0; i < MaxSubscriptionsPerUser+3; i++ {
			_, err := Save(ctx, db, oleg, sub(fmt.Sprintf("oleg-%02d", i)))
			require.NoError(t, err)
		}
		var count int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM users.push_subscriptions WHERE user_id = $1`, oleg).Scan(&count))
		require.Equal(t, MaxSubscriptionsPerUser, count)
	})

	t.Run("получатели: участники без отправителя, имена, язык, выключенные уведомления", func(t *testing.T) {
		members, err := directory.MembersExcept(ctx, chatID, igor)
		require.NoError(t, err)
		sort.Strings(members)
		require.Equal(t, []string{masha, oleg}, members)

		member, err := directory.IsMember(ctx, chatID, masha)
		require.NoError(t, err)
		require.True(t, member)

		info, err := directory.ChatInfo(ctx, chatID)
		require.NoError(t, err)
		require.Equal(t, ChatInfo{Type: "group", Title: "Команда"}, info)

		name, err := directory.DisplayName(ctx, igor)
		require.NoError(t, err)
		require.Equal(t, "Игорь", name)

		_, err = db.Exec(`INSERT INTO users.settings (user_id, settings) VALUES ($1, '{"notifications":true,"language":"en"}')`, masha)
		require.NoError(t, err)
		_, err = db.Exec(`INSERT INTO users.settings (user_id, settings) VALUES ($1, '{"notifications":false,"language":"ru"}')`, oleg)
		require.NoError(t, err)

		targets, err := directory.Targets(ctx, []string{masha, oleg})
		require.NoError(t, err)
		require.Len(t, targets, 1, "у выключившего уведомления подписок в выдаче нет")
		require.Equal(t, masha, targets[0].UserID)
		require.Equal(t, "en", targets[0].Lang)

		require.NoError(t, directory.DeleteSubscription(ctx, targets[0].SubscriptionID))
		targets, err = directory.Targets(ctx, []string{masha})
		require.NoError(t, err)
		require.Empty(t, targets)
	})

	t.Run("аккаунт удалён — подписки тоже", func(t *testing.T) {
		const gone = "dddddddd-4444-4444-8444-444444444444"
		dbtest.User(t, db, gone, "push_gone")
		_, err := Save(ctx, db, gone, sub("gone-phone"))
		require.NoError(t, err)

		_, err = db.Exec(`DELETE FROM auth.users WHERE id = $1`, gone)
		require.NoError(t, err)
		var count int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM users.push_subscriptions WHERE user_id = $1`, gone).Scan(&count))
		require.Zero(t, count)
	})
}
