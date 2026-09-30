//go:build integration

package integration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"

	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// stubTokenVerifier принимает любой токен и считает его userID —
// крипто-сервис не является seam этой задачи.
type stubTokenVerifier struct{}

func (stubTokenVerifier) VerifyToken(_ context.Context, token string) (cryptoclient.TokenClaims, error) {
	return cryptoclient.TokenClaims{Subject: token}, nil
}

// TestWSChatMessage_Unsupported проверяет регрессионный контракт CHAT-B011:
// входящая команда chat_message более не поддерживается сервером и игнорируется в readPump.
//
// Инварианты:
// 1. Сообщение не сохраняется в messages.messages (БД пуста).
// 2. Broadcast-сообщение не рассылается другим участникам (owner получает timeout в requireNoFrame).
// 3. Отправитель не получает chat_message_error или иных кадров, отличных от ответа на ping.
//
// Детерминизм: после отправки chat_message отправляется ping; получение pong гарантирует,
// что предыдущий кадр chat_message уже был прочитан и обработан в readPump без гонки с проверкой БД.
func TestWSChatMessage_Unsupported(t *testing.T) {
	db := setupPostgres(t)
	ownerID := seedUser(t, db, "owner")
	memberID := seedUser(t, db, "member")
	chatID := seedGroupChat(t, db, ownerID, memberID)

	ws := chat.NewWSServer(db, stubTokenVerifier{}, nil)
	t.Cleanup(ws.Close)
	srv := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	t.Cleanup(srv.Close)

	owner := dialWS(t, srv, ownerID)
	member := dialWS(t, srv, memberID)
	t.Cleanup(func() {
		_ = owner.Close()
	})
	t.Cleanup(func() {
		_ = member.Close()
	})

	sendChatMessage(t, member, chatID, "ws-unsupported-payload")
	sendPing(t, member)

	pongFrame := readFrame(t, member)
	require.Equal(t, "pong", pongFrame["type"], "ожидали ответ pong на ping, подтверждающий обработку предыдущего кадра")
	requireNoFrame(t, owner)
	require.Equal(t, 0, countMessages(t, db, chatID), "сообщение не должно быть сохранено в базе данных")
}

func sendPing(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, conn.WriteJSON(map[string]any{
		"type": "ping",
	}))
}

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
	files, err := filepath.Glob("../../../../migrations/*.sql")
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no migration files found")
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

// seedGroupChat создаёт групповой чат: ownerID — owner, memberID — member.
func seedGroupChat(t *testing.T, db *sql.DB, ownerID, memberID string) string {
	t.Helper()
	var chatID string
	err := db.QueryRow(
		`INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'g', $1) RETURNING id::text`,
		ownerID).Scan(&chatID)
	if err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	for userID, role := range map[string]string{ownerID: "owner", memberID: "member"} {
		if _, err := db.Exec(
			`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, $3)`,
			chatID, userID, role); err != nil {
			t.Fatalf("seed member %s: %v", userID, err)
		}
	}
	return chatID
}

func countMessages(t *testing.T, db *sql.DB, chatID string) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(
		`SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatID).Scan(&n))
	return n
}

// dialWS открывает WS-соединение: cookie-токен = userID (см. stubTokenVerifier).
func dialWS(t *testing.T, srv *httptest.Server, userID string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	header := http.Header{"Cookie": {"craneapp_session=" + userID}, "Origin": {srv.URL}}
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	return conn
}

func sendChatMessage(t *testing.T, conn *websocket.Conn, chatID, content string) {
	t.Helper()
	require.NoError(t, conn.WriteJSON(map[string]any{
		"type":    "chat_message",
		"chatId":  chatID,
		"content": content,
	}))
}

// readFrame читает один JSON-фрейм с дедлайном.
func readFrame(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(3*time.Second)))
	var frame map[string]any
	require.NoError(t, conn.ReadJSON(&frame))
	return frame
}

// requireNoFrame проверяет, что за 300 мс соединение ничего не получило (ожидается сетевой таймаут).
func requireNoFrame(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(300*time.Millisecond)))
	var frame map[string]any
	err := conn.ReadJSON(&frame)
	require.Error(t, err, "не ожидали фрейм, получили: %v", frame)
	var netErr net.Error
	require.True(t, errors.As(err, &netErr) && netErr.Timeout(), "ожидали сетевой таймаут, получили: %v", err)
}
