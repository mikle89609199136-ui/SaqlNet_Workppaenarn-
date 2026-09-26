//go:build integration

package chat

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/presence"
)

// Настоящий SQL рассылки presence_changed: кому уходит событие, решает та
// же проверка, что и для статуса и данных чата (#783, #784).
func TestPresenceAudienceOnRealSchema(t *testing.T) {
	const (
		owner    = "11111111-1111-4111-8111-111111111111"
		plain    = "22222222-2222-4222-8222-222222222222"
		blocked  = "33333333-3333-4333-8333-333333333333"
		denied   = "44444444-4444-4444-8444-444444444444"
		allowed  = "55555555-5555-4555-8555-555555555555"
		stranger = "66666666-6666-4666-8666-666666666666"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	for id, name := range map[string]string{owner: "owner", plain: "plain", blocked: "blocked", denied: "denied", allowed: "allowed", stranger: "stranger"} {
		dbtest.User(t, db, id, name)
	}
	chats := NewService(db, nil, nil)
	for _, peer := range []string{plain, blocked, denied, allowed} {
		_, _, err := chats.CreatePrivate(ctx, owner, peer)
		require.NoError(t, err)
	}
	_, err := db.Exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, owner, blocked)
	require.NoError(t, err)
	_, err = db.Exec(`
		INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow) VALUES
		($1, $2, 'lastSeen', FALSE), ($1, $3, 'lastSeen', TRUE), ($1, $4, 'photoVisibility', FALSE)`,
		owner, denied, allowed, plain)
	require.NoError(t, err)

	audience := func() []string {
		t.Helper()
		peers, err := dbPresenceActivity{db: db}.Audience(ctx, owner)
		require.NoError(t, err)
		return peers
	}

	// Настроек нет — статус открыт всем, кроме заблокированного и «никогда».
	// Исключение на фото статус не трогает.
	require.ElementsMatch(t, []string{plain, allowed}, audience())

	_, err = db.Exec(`INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, '{"lastSeen":"nobody"}')`, owner)
	require.NoError(t, err)
	require.Equal(t, []string{allowed}, audience(), "закрытый статус — только «всегда разрешать»")

	// Взаимность (#791): собеседник, скрывший своё время, событий не
	// получает — если только не открыл его владельцу исключением.
	_, err = db.Exec(`UPDATE users.settings SET privacy_settings = '{"lastSeen":"all"}' WHERE user_id = $1`, owner)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, '{"lastSeen":"nobody"}')`, plain)
	require.NoError(t, err)
	require.Equal(t, []string{allowed}, audience(), "plain скрыл своё")
	_, err = db.Exec(`INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow) VALUES ($1, $2, 'lastSeen', TRUE)`, plain, owner)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{plain, allowed}, audience(), "plain открыл своё владельцу")
}

// Настоящий SQL списка «в сети» в группе: скрывший статус участник в него
// не попадает, хотя подключён (#784).
func TestOnlineMembersOnRealSchema(t *testing.T) {
	const (
		viewer  = "11111111-1111-4111-8111-111111111111"
		hidden  = "22222222-2222-4222-8222-222222222222"
		allowed = "33333333-3333-4333-8333-333333333333"
		denied  = "44444444-4444-4444-8444-444444444444"
		blocker = "55555555-5555-4555-8555-555555555555"
		open    = "66666666-6666-4666-8666-666666666666"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	for id, name := range map[string]string{viewer: "viewer", hidden: "hidden", allowed: "allowed", denied: "denied", blocker: "blocker", open: "open"} {
		dbtest.User(t, db, id, name)
	}
	_, err := db.Exec(`
		INSERT INTO users.settings (user_id, privacy_settings) VALUES
		($1, '{"lastSeen":"nobody"}'), ($2, '{"lastSeen":"nobody"}')`,
		hidden, allowed)
	require.NoError(t, err)
	_, err = db.Exec(`
		INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow) VALUES
		($2, $1, 'lastSeen', TRUE), ($3, $1, 'lastSeen', FALSE), ($4, $1, 'lastSeen', TRUE)`,
		viewer, allowed, denied, blocker)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, blocker, viewer)
	require.NoError(t, err)

	store := presence.NewMemoryStore(time.Now)
	members := []string{hidden, allowed, denied, blocker, open}
	for _, id := range append([]string{viewer}, members...) {
		require.NoError(t, store.Connect(ctx, id, "conn-"+id))
	}
	service := NewService(db, nil, store)
	chatID, err := service.CreateGroup(ctx, viewer, "group", "", "", members)
	require.NoError(t, err)

	online, err := service.GetOnlineMembers(ctx, chatID, viewer)

	require.NoError(t, err)
	// Себя видно всегда; скрытый, «никогда» и заблокировавший — нет.
	require.ElementsMatch(t, []string{viewer, allowed, open}, online)

	// Взаимность (#791): зритель скрыл своё — видит только себя...
	_, err = db.Exec(`INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, '{"lastSeen":"nobody"}')`, viewer)
	require.NoError(t, err)
	online, err = service.GetOnlineMembers(ctx, chatID, viewer)
	require.NoError(t, err)
	require.Equal(t, []string{viewer}, online)

	// ...и тех, кому открыл своё исключением, если они открыли своё ему.
	_, err = db.Exec(`
		INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow) VALUES
		($1, $2, 'lastSeen', TRUE), ($1, $3, 'lastSeen', TRUE)`, viewer, open, hidden)
	require.NoError(t, err)
	online, err = service.GetOnlineMembers(ctx, chatID, viewer)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{viewer, open}, online, "hidden скрыл своё от зрителя — взаимность в обе стороны")
}
