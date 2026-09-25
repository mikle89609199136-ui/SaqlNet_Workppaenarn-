//go:build integration

package privacy_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/privacy"
)

const (
	owner  = "11111111-1111-4111-8111-111111111111"
	viewer = "22222222-2222-4222-8222-222222222222"
)

func startDatabase(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:16",
			ExposedPorts: []string{"5432/tcp"},
			Env:          map[string]string{"POSTGRES_PASSWORD": "test", "POSTGRES_DB": "test"},
			WaitingFor: wait.ForAll(
				wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
				wait.ForListeningPort("5432/tcp"),
			).WithDeadline(60 * time.Second),
		},
		Started: true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	host, err := container.Host(ctx)
	require.NoError(t, err)
	port, err := container.MappedPort(ctx, "5432")
	require.NoError(t, err)
	db, err := sql.Open("postgres", fmt.Sprintf("postgres://postgres:test@%s:%s/test?sslmode=disable", host, port.Port()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	files, err := filepath.Glob("../../../migrations/*.sql")
	require.NoError(t, err)
	sort.Strings(files)
	for _, file := range files {
		content, err := os.ReadFile(file)
		require.NoError(t, err)
		_, err = db.Exec(string(content))
		require.NoError(t, err, file)
	}

	for _, u := range []struct{ id, name string }{{owner, "owner_user"}, {viewer, "viewer_user"}} {
		_, err := db.Exec(`INSERT INTO auth.users (id, username, password_hash, first_name) VALUES ($1, $2, 'hash', $2)`, u.id, u.name)
		require.NoError(t, err)
	}
	return db
}

func setPrivacy(t *testing.T, db *sql.DB, userID, raw string) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, $2::jsonb)
		ON CONFLICT (user_id) DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings`, userID, raw)
	require.NoError(t, err)
}

func allowed(t *testing.T, db *sql.DB, ownerID, viewerID string, rule privacy.Rule) bool {
	t.Helper()
	ok, err := privacy.Allowed(context.Background(), db, ownerID, viewerID, rule)
	require.NoError(t, err)
	return ok
}

func TestAllowedOnRealSchema(t *testing.T) {
	db := startDatabase(t)

	// Настроек ещё нет — действуют значения по умолчанию.
	require.True(t, allowed(t, db, owner, viewer, privacy.LastSeen))
	require.False(t, allowed(t, db, owner, viewer, privacy.Phone))

	setPrivacy(t, db, owner, `{"lastSeen":"nobody","photoVisibility":"contacts"}`)
	require.False(t, allowed(t, db, owner, viewer, privacy.LastSeen))
	require.False(t, allowed(t, db, owner, viewer, privacy.Photo), "contacts — как nobody")
	require.True(t, allowed(t, db, owner, owner, privacy.LastSeen), "себе — всегда")

	setPrivacy(t, db, owner, `{"lastSeen":"all"}`)
	require.True(t, allowed(t, db, owner, viewer, privacy.LastSeen))
	_, err := db.Exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, owner, viewer)
	require.NoError(t, err)
	require.False(t, allowed(t, db, owner, viewer, privacy.LastSeen), "блокировка сильнее правила")

	require.False(t, allowed(t, db, "33333333-3333-4333-8333-333333333333", viewer, privacy.LastSeen), "владельца нет")
}

// Настоящий SQL списка и карточки чата: собеседник, закрывший фото и
// статус, не раскрывает их ни там, ни там (#463, #783).
func TestChatDataHidesWhatThePeerClosed(t *testing.T) {
	db := startDatabase(t)
	ctx := context.Background()
	_, err := db.Exec(`INSERT INTO users.profiles (user_id, first_name, avatar_url) VALUES ($1, 'Owner', '/api/v2/media/avatar')`, owner)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO users.presence (user_id, online, last_seen_at) VALUES ($1, TRUE, NOW())`, owner)
	require.NoError(t, err)

	service := chat.NewService(db, nil, nil)
	chatID, _, err := service.CreatePrivate(ctx, viewer, owner)
	require.NoError(t, err)

	peer := func() chat.Chat {
		chats, err := service.List(ctx, viewer, false)
		require.NoError(t, err)
		require.Len(t, chats, 1)
		detail, err := service.Get(ctx, viewer, chatID)
		require.NoError(t, err)
		require.Equal(t, chats[0].PeerIsOnline, detail.PeerIsOnline, "список и карточка должны совпадать")
		require.Equal(t, chats[0].AvatarURL, detail.AvatarURL, "список и карточка должны совпадать")
		return detail
	}

	open := peer()
	require.True(t, open.PeerIsOnline)
	require.NotEmpty(t, open.PeerLastSeen)
	require.Equal(t, "/api/v2/media/avatar", open.AvatarURL)

	setPrivacy(t, db, owner, `{"lastSeen":"nobody","photoVisibility":"nobody"}`)
	closed := peer()
	require.False(t, closed.PeerIsOnline)
	require.Empty(t, closed.PeerLastSeen)
	require.Empty(t, closed.AvatarURL)

	setPrivacy(t, db, owner, `{"lastSeen":"all","photoVisibility":"all"}`)
	_, err = db.Exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, owner, viewer)
	require.NoError(t, err)
	blocked := peer()
	require.False(t, blocked.PeerIsOnline)
	require.Empty(t, blocked.AvatarURL)
}
