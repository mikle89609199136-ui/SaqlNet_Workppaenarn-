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
	blockHeartbeat           chan struct{}
	disconnectCalled         chan struct{}
}

func (s *recordingStore) Connect(_ context.Context, _ string, connID string) error {
	s.mu.Lock()
	s.connects = append(s.connects, connID)
	s.mu.Unlock()
	return s.connectErr
}

// Heartbeat фиксирует вызов heartbeat в тестовом хранилище.
// При наличии blockHeartbeat имитирует долгий сетевой I/O к Redis:
// сначала сигнализирует в heartbeatCalled о начале выполнения, затем ждёт
// разблокировки канала и проверяет, не вызывался ли Disconnect во время ожидания.
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
	block := s.blockHeartbeat
	s.mu.Unlock()

	if ch != nil {
		select {
		case ch <- struct{}{}:
		default:
		}
	}

	if block != nil {
		<-block
	}

	s.mu.Lock()

	for _, d := range s.disconnects {
		if d == connID {
			s.heartbeatAfterDisconnect = true
			break
		}
	}
	s.mu.Unlock()

	return nil
}

func (s *recordingStore) Disconnect(_ context.Context, _ string, connID string) error {
	s.mu.Lock()
	s.disconnects = append(s.disconnects, connID)
	block := s.blockDisconnect
	s.mu.Unlock()

	if s.disconnectCalled != nil {
		select {
		case s.disconnectCalled <- struct{}{}:
		default:
		}
	}

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

// TestWSPresence_DisconnectPreventsLateHeartbeat проверяет, что при наличии in-flight
// вызова Heartbeat вызов Disconnect блокируется до полного завершения Heartbeat,
// исключая воскрешение закрытого соединения.
func TestWSPresence_DisconnectPreventsLateHeartbeat(t *testing.T) {
	blockHeartbeat := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-blockHeartbeat:
		default:
			close(blockHeartbeat)
		}
	})
	hbCalled := make(chan struct{}, 1)
	disconnCalled := make(chan struct{}, 1)
	rec := &recordingStore{
		blockHeartbeat:   blockHeartbeat,
		heartbeatCalled:  hbCalled,
		disconnectCalled: disconnCalled,
	}
	srv, ws := newPresenceTestServer(t, rec)
	conn := dialWS(t, srv)
	require.Eventually(t, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.connects) == 1
	}, 500*time.Millisecond, 5*time.Millisecond, "Connect не пытался выполниться")

	require.Eventually(t, func() bool {
		ws.mu.RLock()
		defer ws.mu.RUnlock()
		for _, m := range ws.clients {
			if len(m) > 0 {
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

	select {
	case <-disconnCalled:
		close(blockHeartbeat)
		require.Eventually(t, func() bool {
			rec.mu.Lock()
			defer rec.mu.Unlock()
			return rec.heartbeatAfterDisconnect
		}, 500*time.Millisecond, 5*time.Millisecond)
		require.False(t, rec.heartbeatAfterDisconnect, "Heartbeat завершился после вызова Disconnect (воскрешение lease)")
	case <-time.After(100 * time.Millisecond):
		close(blockHeartbeat)
		require.Eventually(t, func() bool {
			rec.mu.Lock()
			defer rec.mu.Unlock()
			return len(rec.disconnects) == 1
		}, 500*time.Millisecond, 5*time.Millisecond, "Disconnect не был вызван после завершения Heartbeat")
		require.False(t, rec.heartbeatAfterDisconnect, "Heartbeat не должен завершаться после Disconnect")
	}

}
