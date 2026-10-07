//go:build integration

package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
)

type revocationVerifier map[string]cryptoclient.TokenClaims

func (v revocationVerifier) VerifyToken(_ context.Context, token string) (cryptoclient.TokenClaims, error) {
	return v[token], nil
}

// Real PostgreSQL, Auth HTTP handlers and two Chat replicas: idle sockets must
// close through NOTIFY, independently of the heartbeat/per-command fallback.
func TestActiveWSLogoutAcrossReplicas(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "*")
	db, url := dbtest.PostgresURL(t)
	const user = "aaaaaaaa-0409-4409-8409-111111111111"
	const other = "bbbbbbbb-0409-4409-8409-222222222222"
	dbtest.User(t, db, user, "logout_user")
	dbtest.User(t, db, other, "logout_other")
	expires := time.Now().Add(time.Hour).Unix()
	verifier := revocationVerifier{
		"a":     {Subject: user, Expires: expires},
		"b":     {Subject: user, Expires: expires},
		"new":   {Subject: user, Expires: expires, TokenGeneration: 1},
		"other": {Subject: other, Expires: expires},
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	var servers []*httptest.Server
	var replicas []*WSServer
	for i := 0; i < 2; i++ {
		ws := NewWSServer(db, verifier, nil)
		ws.activity = nil
		ws.pingInterval = time.Hour
		srv := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
		done := make(chan struct{})
		go func() { defer close(done); RevocationRelay(ctx, url, ws) }()
		t.Cleanup(func() {
			srv.Close()
			require.Eventually(t, func() bool { return !ws.IsUserConnected(user) && !ws.IsUserConnected(other) }, 2*time.Second, time.Millisecond)
			cancel()
			<-done
			ws.Close()
		})
		servers = append(servers, srv)
		replicas = append(replicas, ws)
	}
	require.Eventually(t, func() bool {
		var count int
		err := db.QueryRow(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'LISTEN%' AND query LIKE '%auth_token_revoked%'`).Scan(&count)
		return err == nil && count == 2
	}, 5*time.Second, 10*time.Millisecond, "both chat listeners must be ready")

	svc := auth.NewService(db, nil)
	handler := auth.NewHandler(svc, auth.WithLogoutAllGenerationEnabled(true))
	middleware := authctx.Middleware(verifier, authctx.NewDBTokenChecker(db))
	logout := func(all bool, token string) {
		t.Helper()
		endpoint := handler.Logout
		if all {
			endpoint = handler.LogoutAll
		}
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: token})
		rec := httptest.NewRecorder()
		middleware(http.HandlerFunc(endpoint)).ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	a1 := revocationDial(t, servers[0], "a")
	a2 := revocationDial(t, servers[1], "a")
	b1 := revocationDial(t, servers[0], "b")
	b2 := revocationDial(t, servers[1], "b")
	unaffected := revocationDial(t, servers[1], "other")
	for _, c := range []*websocket.Conn{a1, a2, b1, b2, unaffected} {
		revocationPing(t, c)
	}

	// Rolled back notifications must not disconnect anyone.
	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	require.NoError(t, authctx.NotifyRevocation(ctx, tx, authctx.RevocationEvent{UserID: user, TokenHash: authctx.TokenHash("b")}))
	require.NoError(t, tx.Rollback())

	logout(false, "a")
	requireRevocationClosed(t, a1)
	requireRevocationClosed(t, a2)
	revocationPing(t, b1)
	revocationPing(t, b2)
	revocationPing(t, unaffected)

	logout(true, "b")
	requireRevocationClosed(t, b1)
	requireRevocationClosed(t, b2)
	revocationPing(t, unaffected)

	// Old credentials cannot reconnect; a fresh generation survives even a
	// delayed duplicate notification of the preceding logout-all.
	_, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(servers[0].URL, "http"), http.Header{"Cookie": {authctx.SessionCookieName() + "=b"}, "Origin": {servers[0].URL}})
	require.Error(t, err)
	require.Equal(t, http.StatusUnauthorized, response.StatusCode)
	_ = response.Body.Close()
	fresh := revocationDial(t, servers[0], "new")
	revocationPing(t, fresh)
	require.NoError(t, replicas[0].applyRevocation(`{"userId":"`+user+`","generation":1}`))
	revocationPing(t, fresh)
}
