package chat

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
)

type changingTokenChecker struct {
	calls                atomic.Int64
	revoked              atomic.Bool
	failed               atomic.Bool
	revokeAfterHandshake bool
}

func (c *changingTokenChecker) IsTokenRevoked(context.Context, string, cryptoclient.TokenClaims) (bool, error) {
	n := c.calls.Add(1)
	if c.failed.Load() {
		return false, errors.New("database unavailable")
	}
	return c.revoked.Load() || (c.revokeAfterHandshake && n > 1), nil
}

func revocationTestServer(t *testing.T, checker *changingTokenChecker, interval time.Duration) (*WSServer, *httptest.Server) {
	t.Helper()
	t.Setenv("ALLOWED_ORIGINS", "*")
	ws := NewWSServer(nil, fakeTokenVerifier{claims: cryptoclient.TokenClaims{Subject: "user"}}, nil)
	ws.tokenChecker = checker
	ws.pingInterval = interval
	srv := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	t.Cleanup(func() {
		srv.Close()
		require.Eventually(t, func() bool { return !ws.IsUserConnected("user") }, time.Second, time.Millisecond)
		ws.Close()
	})
	return ws, srv
}

func revocationDial(t *testing.T, srv *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), http.Header{"Cookie": {authctx.SessionCookieName() + "=" + token}, "Origin": {srv.URL}})
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func revocationPing(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	require.NoError(t, conn.WriteJSON(map[string]string{"type": "ping"}))
	var msg map[string]string
	require.NoError(t, conn.ReadJSON(&msg))
	require.Equal(t, "pong", msg["type"])
}

func requireRevocationClosed(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	_, _, err := conn.ReadMessage()
	require.Error(t, err)
	var timeout interface{ Timeout() bool }
	if errors.As(err, &timeout) {
		require.False(t, timeout.Timeout(), "socket must close, not time out")
	}
}

func TestActiveWSRejectsEventsAfterRevocationOrCheckFailure(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "revoked"
		if failed {
			name = "database failure"
		}
		t.Run(name, func(t *testing.T) {
			checker := &changingTokenChecker{}
			_, srv := revocationTestServer(t, checker, time.Hour)
			conn := revocationDial(t, srv, "token")
			revocationPing(t, conn)
			if failed {
				checker.failed.Store(true)
			} else {
				checker.revoked.Store(true)
			}
			require.NoError(t, conn.WriteJSON(map[string]string{"type": "ping"}))
			requireRevocationClosed(t, conn)
		})
	}
}

func TestActiveWSHeartbeatClosesAfterMissedRevocationNotification(t *testing.T) {
	checker := &changingTokenChecker{}
	_, srv := revocationTestServer(t, checker, 100*time.Millisecond)
	conn := revocationDial(t, srv, "token")
	revocationPing(t, conn)
	checker.revoked.Store(true)
	requireRevocationClosed(t, conn)
}

func TestActiveWSRechecksRevocationAfterHandshake(t *testing.T) {
	checker := &changingTokenChecker{revokeAfterHandshake: true}
	_, srv := revocationTestServer(t, checker, time.Hour)
	conn := revocationDial(t, srv, "token")
	requireRevocationClosed(t, conn)
}
