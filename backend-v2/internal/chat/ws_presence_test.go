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

	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/presence"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
)

// recordingStore регистрирует вызовы presence-методов для assertions.
type recordingStore struct {
	mu                       sync.Mutex
	connects                 []string // connID каждого Connect-вызова
	heartbeats               []string
	disconnects              []string
	connectErr               error
	heartbeatAfterDisconnect bool
	blockDisconnect          chan struct{}
	heartbeatCalled          chan struct{}
}

func (s *recordingStore) Connect(_ context.Context, _ string, connID string) error {
	s.mu.Lock()
	s.connects = append(s.connects, connID)
	s.mu.Unlock()
	return s.connectErr
}

func (s *recordingStore) Heartbeat(_ context.Context, _ string, connID string) error {
	s.mu.Lock()

	for _, d := range s.disconnects {
		if d == connID {
			s.heartbeatAfterDisconnect = true
			break
		}
	}

	s.heartbeats = append(s.heartbeats, connID)
	ch := s.heartbeatCalled
	s.mu.Unlock()

	if ch != nil {
		select {
		case ch <- struct{}{}:
		default:
		}
	}

	return nil
}

func (s *recordingStore) Disconnect(_ context.Context, _ string, connID string) error {
	s.mu.Lock()
	s.disconnects = append(s.disconnects, connID)
	block := s.blockDisconnect
	s.mu.Unlock()
	if block != nil {
		<-block
	}
	return nil
}

func (s *recordingStore) OnlineUsers(_ context.Context, _ []string) ([]string, error) {
	return nil, nil
}

// newPresenceTestServer собирает WSServer с заданным store,
// регистрирует httptest.Server и возвращает оба.
func newPresenceTestServer(t *testing.T, store presence.Store) (*httptest.Server, *WSServer) {
	t.Helper()
	db, _, _ := sqlmock.New()
	ws := &WSServer{
		db:             db,
		crypto:         fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "pres-user1"}},
		presence:       store,
		pingInterval:   5 * time.Millisecond,
		clients:        make(map[string]map[*Client]bool),
		register:       make(chan *Client, 1),
		unreg:          make(chan *Client, 1),
		callRooms:      NewCallRoomManager(),
		pendingInvites: make(map[string]json.RawMessage),
	}
	go ws.run()
	srv := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	t.Cleanup(srv.Close)
	return srv, ws
}

// dialWS подключается к тестовому WS-серверу; регистрирует закрытие.
func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?token=tok"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

// TestWSPresence_Connect проверяет, что ServeWS вызывает presence.Connect
// ровно один раз с userID подключившегося клиента.
func TestWSPresence_Connect(t *testing.T) {
	rec := &recordingStore{}
	srv, _ := newPresenceTestServer(t, rec)

	_ = dialWS(t, srv)

	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.connects) == 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Connect не был вызван")
}

// TestWSPresence_Heartbeat проверяет, что фоновый heartbeat продлевает
// lease в presence.Store для активного соединения.
func TestWSPresence_Heartbeat(t *testing.T) {
	rec := &recordingStore{}
	srv, _ := newPresenceTestServer(t, rec)

	_ = dialWS(t, srv)

	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.heartbeats) >= 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Heartbeat не был вызван")
}

// TestWSPresence_Disconnect проверяет, что при закрытии WebSocket-соединения
// presence.Disconnect вызывается ровно один раз.
func TestWSPresence_Disconnect(t *testing.T) {
	rec := &recordingStore{}
	srv, _ := newPresenceTestServer(t, rec)

	conn := dialWS(t, srv)
	_ = conn.Close()

	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.disconnects) == 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Disconnect не был вызван")
}

// TestWSPresence_StoreErrorDoesNotBreakWS проверяет, что ошибка presence-store
// при Connect не приводит к обрыву WebSocket-соединения.
func TestWSPresence_StoreErrorDoesNotBreakWS(t *testing.T) {
	rec := &recordingStore{connectErr: errors.New("redis offline")}
	srv, _ := newPresenceTestServer(t, rec)

	conn := dialWS(t, srv)
	require.NotNil(t, conn)

	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.connects) == 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Connect не пытался выполниться")
}

// TestWSPresence_DisconnectPreventsLateHeartbeat проверяет, что после вызова Disconnect
// последующие тики heartbeat гарантированно не отправляются в Store, исключая воскрешение закрытого соединения.
func TestWSPresence_DisconnectPreventsLateHeartbeat(t *testing.T) {
	block := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-block:
		default:
			close(block)
		}
	})
	hbCalled := make(chan struct{}, 1)
	rec := &recordingStore{
		blockDisconnect: block,
		heartbeatCalled: hbCalled,
	}
	srv, ws := newPresenceTestServer(t, rec)
	conn := dialWS(t, srv)
	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.connects) == 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Connect не пытался выполниться")

	var client *Client
	require.Eventually(t, func() bool {
		ws.mu.RLock()
		defer ws.mu.RUnlock()
		for _, m := range ws.clients {
			for c := range m {
				client = c
				return true
			}
		}
		return false
	}, 500*time.Millisecond, 5*time.Millisecond, "Клиент не зарегистрирован в WSServer")

	select {
	case <-hbCalled:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Heartbeat не начал выполняться")
	}

	_ = conn.Close()
	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.disconnects) == 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Disconnect не был вызван")
	select {
	case <-client.done:
	case <-hbCalled:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Таймаут ожидания реакции heartbeat")
	}
	close(block)
	require.False(t, rec.heartbeatAfterDisconnect, "Heartbeat был вызван после Disconnect")
}
