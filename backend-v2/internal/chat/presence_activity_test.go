package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
)

var presenceTestTime = time.Date(2026, 9, 26, 12, 30, 0, 0, time.UTC)

type touch struct {
	userID string
	online bool
}

// fakeActivity записывает отметки и отдаёт заданную аудиторию.
type fakeActivity struct {
	mu        sync.Mutex
	touches   []touch
	audiences int
	peers     []string
	visible   bool
}

func (a *fakeActivity) Touch(_ context.Context, userID string, online bool) (time.Time, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.touches = append(a.touches, touch{userID, online})
	return presenceTestTime, nil
}

func (a *fakeActivity) Audience(context.Context, string) ([]string, bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.audiences++
	return a.peers, a.visible, nil
}

func (a *fakeActivity) snapshot() ([]touch, int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]touch(nil), a.touches...), a.audiences
}

func presenceServer(activity presenceActivity) *WSServer {
	return &WSServer{
		clients:  make(map[string]map[*Client]bool),
		activity: activity,
	}
}

func connectLocal(ws *WSServer, userID string) *Client {
	client := &Client{UserID: userID, Send: make(chan []byte, 8), done: make(chan struct{})}
	ws.mu.Lock()
	if ws.clients[userID] == nil {
		ws.clients[userID] = make(map[*Client]bool)
	}
	ws.clients[userID][client] = true
	ws.mu.Unlock()
	return client
}

func receivedEvent(t *testing.T, client *Client) map[string]any {
	t.Helper()
	select {
	case raw := <-client.Send:
		var event map[string]any
		require.NoError(t, json.Unmarshal(raw, &event))
		return event
	case <-time.After(time.Second):
		t.Fatal("событие не пришло")
		return nil
	}
}

func requireNoEvent(t *testing.T, client *Client) {
	t.Helper()
	select {
	case raw := <-client.Send:
		t.Fatalf("неожиданное событие: %s", raw)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestAnnouncePresenceTellsPrivateChatPeers(t *testing.T) {
	activity := &fakeActivity{peers: []string{"peer-1"}, visible: true}
	ws := presenceServer(activity)
	peer := connectLocal(ws, "peer-1")
	stranger := connectLocal(ws, "stranger")

	ws.announcePresence("user-1", true)

	require.Equal(t, map[string]any{
		"type":     "presence_changed",
		"userId":   "user-1",
		"isOnline": true,
		"lastSeen": "2026-09-26T12:30:00Z",
	}, receivedEvent(t, peer))
	requireNoEvent(t, stranger)
	touches, _ := activity.snapshot()
	require.Equal(t, []touch{{"user-1", true}}, touches)
}

func TestAnnouncePresenceKeepsHiddenStatusPrivate(t *testing.T) {
	activity := &fakeActivity{peers: []string{"peer-1"}, visible: false}
	ws := presenceServer(activity)
	peer := connectLocal(ws, "peer-1")

	ws.announcePresence("user-1", true)

	// Время активности записано, но собеседникам ничего не ушло: событие
	// само выдало бы, что человек в сети.
	requireNoEvent(t, peer)
	touches, _ := activity.snapshot()
	require.Len(t, touches, 1)
}

func TestAnnounceOfflineWaitsForTheLastConnection(t *testing.T) {
	activity := &fakeActivity{peers: []string{"peer-1"}, visible: true}
	ws := presenceServer(activity)
	peer := connectLocal(ws, "peer-1")
	first := connectLocal(ws, "user-1")
	second := connectLocal(ws, "user-1")

	// Закрыли одно окно из двух — человек всё ещё в сети.
	ws.announceOffline(first)
	requireNoEvent(t, peer)
	touches, _ := activity.snapshot()
	require.Empty(t, touches)

	ws.mu.Lock()
	delete(ws.clients["user-1"], first)
	ws.mu.Unlock()

	ws.announceOffline(second)
	event := receivedEvent(t, peer)
	require.Equal(t, false, event["isOnline"])
	require.Equal(t, "2026-09-26T12:30:00Z", event["lastSeen"])
}

func TestPresenceWithoutActivityIsSilent(t *testing.T) {
	ws := presenceServer(nil)
	peer := connectLocal(ws, "peer-1")

	ws.announcePresence("user-1", true)
	ws.touchPresence("user-1")

	requireNoEvent(t, peer)
}

// Через настоящий ServeWS: вход сообщается один раз на первое соединение,
// выход — когда закрыто последнее.
func TestServeWSAnnouncesFirstConnectionAndLastDisconnect(t *testing.T) {
	activity := &fakeActivity{visible: true}
	db, _, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	ws := &WSServer{
		db:             db,
		crypto:         fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user-1"}},
		tokenChecker:   fakeTokenChecker{},
		activity:       activity,
		pingInterval:   time.Hour,
		clients:        make(map[string]map[*Client]bool),
		register:       make(chan *Client, 1),
		unreg:          make(chan *Client, 1),
		callRooms:      NewCallRoomManager(),
		pendingInvites: make(map[string]json.RawMessage),
		stop:           make(chan struct{}),
		stopped:        make(chan struct{}),
	}
	go ws.run()
	t.Cleanup(ws.Close)
	srv := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	t.Cleanup(srv.Close)
	dial := func() *websocket.Conn {
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?token=tok", nil)
		require.NoError(t, err)
		return conn
	}
	waitFor := func(check func([]touch, int) bool) {
		require.Eventually(t, func() bool { return check(activity.snapshot()) }, time.Second, 10*time.Millisecond)
	}

	first := dial()
	waitFor(func(touches []touch, audiences int) bool {
		return len(touches) == 1 && touches[0].online && audiences == 1
	})

	// Второе окно — только продление отметки, без рассылки.
	second := dial()
	waitFor(func(touches []touch, audiences int) bool { return len(touches) == 2 && audiences == 1 })

	_ = first.Close()
	// Одно окно ещё открыто — «вышел» не рассылается.
	time.Sleep(100 * time.Millisecond)
	_, audiences := activity.snapshot()
	require.Equal(t, 1, audiences)

	_ = second.Close()
	waitFor(func(touches []touch, audiences int) bool {
		last := touches[len(touches)-1]
		return !last.online && audiences == 2
	})
}

func TestDBPresenceActivity(t *testing.T) {
	t.Run("Touch пишет отметку и возвращает время", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(`INSERT INTO users\.presence`).WithArgs("user-1", false).
			WillReturnRows(sqlmock.NewRows([]string{"last_seen_at"}).AddRow(presenceTestTime))

		lastSeen, err := dbPresenceActivity{db: db}.Touch(context.Background(), "user-1", false)

		require.NoError(t, err)
		require.Equal(t, presenceTestTime, lastSeen)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("скрытый статус не ищет собеседников", func(t *testing.T) {
		for _, setting := range []string{"nobody", "contacts"} {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			mock.ExpectQuery(`FROM users\.settings`).WithArgs("user-1").
				WillReturnRows(sqlmock.NewRows([]string{"last_seen"}).AddRow(setting))

			peers, visible, err := dbPresenceActivity{db: db}.Audience(context.Background(), "user-1")

			require.NoError(t, err)
			require.False(t, visible, setting)
			require.Empty(t, peers)
			require.NoError(t, mock.ExpectationsWereMet())
			_ = db.Close()
		}
	})

	t.Run("открытый статус — собеседники по личным чатам", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		// Настроек нет — статус по умолчанию открыт.
		mock.ExpectQuery(`FROM users\.settings`).WithArgs("user-1").
			WillReturnRows(sqlmock.NewRows([]string{"last_seen"}))
		mock.ExpectQuery(`(?s)JOIN chats\.chats c ON c\.id = me\.chat_id AND c\.type = 'private'`).WithArgs("user-1").
			WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("peer-1").AddRow("peer-2"))

		peers, visible, err := dbPresenceActivity{db: db}.Audience(context.Background(), "user-1")

		require.NoError(t, err)
		require.True(t, visible)
		require.Equal(t, []string{"peer-1", "peer-2"}, peers)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("ошибка чтения настроек не превращается в рассылку", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(`FROM users\.settings`).WithArgs("user-1").WillReturnError(errors.New("db down"))

		peers, visible, err := dbPresenceActivity{db: db}.Audience(context.Background(), "user-1")

		require.Error(t, err)
		require.False(t, visible)
		require.Empty(t, peers)
	})
}
