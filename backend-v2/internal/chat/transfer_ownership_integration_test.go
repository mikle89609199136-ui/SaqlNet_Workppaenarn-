//go:build integration

package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
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
)

func setupPostgres(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	pg, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
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
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = pg.Terminate(ctx) })

	host, _ := pg.Host(ctx)
	if host == "localhost" {
		host = "127.0.0.1"
	}
	port, _ := pg.MappedPort(ctx, "5432")
	dsn := fmt.Sprintf("postgres://postgres:test@%s:%s/test?sslmode=disable", host, port.Port())
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping db: %v", err)
	}

	applyMigrations(t, db)
	return db
}

// applyMigrations применяет backend-v2/migrations/*.sql по порядку — схема из миграций.
func applyMigrations(t *testing.T, db *sql.DB) {
	t.Helper()
	files, err := filepath.Glob("../../migrations/*.sql")
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	sort.Strings(files)
	for _, f := range files {
		sqlText, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read migration %s: %v", f, err)
		}
		if _, err := db.Exec(string(sqlText)); err != nil {
			t.Fatalf("apply migration %s: %v", f, err)
		}
	}
}

func seedUser(t *testing.T, db *sql.DB, username string) string {
	t.Helper()
	var id string
	err := db.QueryRow(
		`INSERT INTO auth.users (username, password_hash, first_name) VALUES ($1, 'x', $1) RETURNING id::text`,
		username).Scan(&id)
	if err != nil {
		t.Fatalf("seed user %s: %v", username, err)
	}
	return id
}

// seedPrivateChat создаёт в базе данных приватный чат (type = 'private') с заданным владельцем (роль 'owner') и вторым участником (роль 'member').
func seedPrivateChat(t *testing.T, db *sql.DB, ownerID, peerID string) string {
	t.Helper()
	var chatID string
	err := db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id) VALUES ('private', 'Private chat', $1) RETURNING id::text`, ownerID).Scan(&chatID)
	if err != nil {
		t.Fatalf("seed private chat: %v", err)
	}
	for userID, role := range map[string]string{ownerID: "owner", peerID: "member"} {
		if _, err := db.Exec(
			`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, $3)`,
			chatID, userID, role); err != nil {
			t.Fatalf("seed member %s: %v", userID, err)
		}
	}
	return chatID
}

// TestTransferOwnership_PrivateChat_Rejected проверяет, что попытка передачи владения
// в приватном чате отклоняется с ErrInvalidChatType, а owner_id и роли участников
// в базе данных остаются неизменными (CHAT-B006).
func TestTransferOwnership_PrivateChat_Rejected(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test")
	}
	db := setupPostgres(t)
	svc := chat.NewService(db, nil, nil)

	ownerID := seedUser(t, db, "owner_user")
	peerID := seedUser(t, db, "peer_user")
	chatID := seedPrivateChat(t, db, ownerID, peerID)

	err := svc.TransferOwnership(context.Background(), ownerID, chatID, peerID)
	require.ErrorIs(t, err, chat.ErrInvalidChatType)

	var currentOwnerID string
	err = db.QueryRow(`SELECT owner_id::text FROM chats.chats WHERE id = $1`, chatID).Scan(&currentOwnerID)
	require.NoError(t, err)
	require.Equal(t, ownerID, currentOwnerID)

	var ownerRole string
	err = db.QueryRow(`SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, ownerID).Scan(&ownerRole)
	require.NoError(t, err)
	require.Equal(t, "owner", ownerRole)

	var peerRole string
	err = db.QueryRow(`SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, peerID).Scan(&peerRole)
	require.NoError(t, err)
	require.Equal(t, "member", peerRole)
}
