//go:build integration

package chat

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
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
}
