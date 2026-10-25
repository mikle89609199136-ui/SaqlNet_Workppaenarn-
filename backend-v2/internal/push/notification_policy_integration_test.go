//go:build integration

package push

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestNotificationPolicyMatrixOnRealDelivery(t *testing.T) {
	const (
		actor = "10420000-0000-4000-8000-000000000021"
		owner = "10420000-0000-4000-8000-000000000022"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, actor, "notification_actor")
	dbtest.User(t, db, owner, "notification_owner")
	var chatID string
	require.NoError(t, db.QueryRow(`INSERT INTO chats.chats(type,owner_id) VALUES('private',$1) RETURNING id::text`, actor).Scan(&chatID))
	for _, id := range []string{actor, owner} {
		_, err := db.Exec(`INSERT INTO chats.members(chat_id,user_id) VALUES($1,$2)`, chatID, id)
		require.NoError(t, err)
	}
	for _, device := range []string{"phone", "laptop"} {
		_, err := Save(ctx, db, owner, Subscription{Endpoint: "https://fcm.googleapis.com/fcm/send/" + device, Keys: validKeys()})
		require.NoError(t, err)
	}
	transport := &fakeTransport{}
	visibility := fakeVisibility{}
	notifier := newTestNotifier(DBDirectory{DB: db}, visibility, transport)
	check := func(t *testing.T, kind Kind, expected int, silent bool) {
		t.Helper()
		transport.sent = nil
		deliverNow(notifier, Event{Kind: kind, ChatID: chatID, ActorID: actor, CalleeID: owner, RoomID: "room"})
		require.Len(t, transport.sent, expected, string(kind))
		for _, sent := range transport.sent {
			require.Equal(t, silent, sent.payload.Silent, string(kind))
			require.Equal(t, 1, sent.payload.V, "добавленное поле сохраняет формат v1")
		}
	}
	// Нет строки settings: общий документированный default, не ошибка/отписка.
	check(t, KindMessage, 2, false)
	check(t, KindCall, 2, false)
	check(t, KindMissedCall, 2, true)
	for bits := 0; bits < 16; bits++ {
		n, s, c, m := bits&1 != 0, bits&2 != 0, bits&4 != 0, bits&8 != 0
		t.Run(fmt.Sprintf("N=%t S=%t C=%t M=%t", n, s, c, m), func(t *testing.T) {
			settings, err := json.Marshal(map[string]bool{"notifications": n, "sounds": s, "callSounds": c})
			require.NoError(t, err)
			_, err = db.Exec(`INSERT INTO users.settings(user_id,settings,sound_settings,notification_settings)
				VALUES($1,$2,'{"messagesSound":false,"notificationsSound":false,"callsSound":false,"mediaVolume":0}',
				'{"privateChats":false,"inAppNotifications":false,"calls":false}')
				ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings`, owner, string(settings))
			require.NoError(t, err)
			_, err = db.Exec(`INSERT INTO chats.user_chat_settings(user_id,chat_id,notifications_muted_at)
				VALUES($1,$2,CASE WHEN $3 THEN NOW() ELSE NULL END)
				ON CONFLICT(user_id,chat_id) DO UPDATE SET notifications_muted_at=EXCLUDED.notifications_muted_at`, owner, chatID, m)
			require.NoError(t, err)
			messages, calls := 0, 0
			if n && !m {
				messages = 2
			}
			if n {
				calls = 2
			}
			check(t, KindMessage, messages, !s)
			check(t, KindCall, calls, !c)
			check(t, KindMissedCall, calls, true)
		})
	}
	for _, raw := range []string{`null`, `[]`, `{"notifications":null}`, `{"notifications":"true"}`} {
		_, err := db.Exec(`UPDATE users.settings SET settings=$2 WHERE user_id=$1`, owner, raw)
		require.NoError(t, err)
		check(t, KindCall, 0, true)
		check(t, KindMessage, 0, true)
	}
	// Видимое устройство пропускается, другая подписка получает ту же sound policy.
	_, err := db.Exec(`UPDATE users.settings SET settings='{"notifications":true,"sounds":false,"callSounds":true}' WHERE user_id=$1`, owner)
	require.NoError(t, err)
	_, err = db.Exec(`UPDATE chats.user_chat_settings SET notifications_muted_at=NULL WHERE user_id=$1`, owner)
	require.NoError(t, err)
	targets, err := (DBDirectory{DB: db}).Targets(ctx, []string{owner}, Event{Kind: KindMessage, ChatID: chatID})
	require.NoError(t, err)
	require.Len(t, targets, 2)
	visibility[owner] = map[string]bool{targets[0].SubscriptionID: true}
	check(t, KindMessage, 1, true)
	check(t, KindCall, 1, false)
	var count int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM users.push_subscriptions WHERE user_id=$1`, owner).Scan(&count))
	require.Equal(t, 2, count, "global/per-chat disable не удаляет подписки")
}
