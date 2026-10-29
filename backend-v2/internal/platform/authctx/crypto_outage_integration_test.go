//go:build integration

package authctx_test

import (
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/user"
	"github.com/stretchr/testify/require"
)

func TestCryptoOutagePreservesCookieAndRecoversHTTPAndWS(t *testing.T) {
	db := dbtest.Postgres(t)
	const userID = "11111111-0425-4425-8425-111111111111"
	dbtest.User(t, db, userID, "generation-test")
	upstream := startIntegrationCryptoServer(t)
	address, err := url.Parse(upstream.URL)
	require.NoError(t, err)
	proxy := httputil.NewSingleHostReverseProxy(address)
	var unavailable atomic.Bool
	dependency := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unavailable.Load() {
			http.Error(w, "private crypto address", 503)
			return
		}
		if r.URL.Path == "/health/ready" {
			_, _ = w.Write([]byte(`{"capabilities":{"token_generation":true}}`))
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(dependency.Close)
	crypto := cryptoclient.NewClient(dependency.URL)
	service := auth.NewService(db, crypto)
	token := loginIntegrationToken(t, service)
	authHandler := auth.NewHandler(service)
	authenticated := authctx.Middleware(crypto, authctx.NewDBTokenChecker(db))
	endpoints := map[string]http.Handler{
		"/api/v2/auth/sessions": authenticated(http.HandlerFunc(authHandler.Sessions)),
		"/api/v2/users/me":      authenticated(http.HandlerFunc(user.NewHandler(user.NewService(db), nil).Me)),
		"/api/v2/chats":         authenticated(http.HandlerFunc(chat.NewHandler(chat.NewService(db, nil, nil)).List)),
	}
	// Same production readiness checks; no failure of a dependency affects liveness.
	ready := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if db.PingContext(r.Context()) != nil || authctx.CheckTokenGenerationSchema(r.Context(), db) != nil || auth.CheckSessionSchema(r.Context(), db) != nil || crypto.CheckTokenGenerationSupport(r.Context()) != nil {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	})
	ws := chat.NewWSServer(db, crypto, nil)
	t.Cleanup(ws.Close)
	socket := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	t.Cleanup(socket.Close)
	for _, down := range []bool{false, true, false} {
		unavailable.Store(down)
		want := 200
		if down {
			want = 503
		}
		request := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
		response := httptest.NewRecorder()
		ready.ServeHTTP(response, request)
		require.Equal(t, want, response.Code)
		for path, handler := range endpoints {
			request = httptest.NewRequest(http.MethodGet, path, nil)
			request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: token})
			response = httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			require.Equal(t, want, response.Code, "%s: %s", path, response.Body.String())
			require.Empty(t, response.Header().Get("Set-Cookie"))
			require.NotContains(t, response.Body.String(), "private crypto address")
		}

		if down {
			request = httptest.NewRequest(http.MethodPost, "/api/v2/auth/login", strings.NewReader(`{"username":"generation-test","password":"password"}`))
			response = httptest.NewRecorder()
			authHandler.Login(response, request)
			require.Equal(t, 503, response.Code, response.Body.String())
			require.Empty(t, response.Header().Get("Set-Cookie"))
			var count int
			require.NoError(t, db.QueryRow("SELECT count(*) FROM auth.sessions WHERE user_id=$1", userID).Scan(&count))
			require.Equal(t, 1, count)
		}
		socketStatus := http.StatusSwitchingProtocols
		if down {
			socketStatus = 503
		}
		assertWebSocketHandshakeStatus(t, socket.URL, token, socketStatus)
	}
}
