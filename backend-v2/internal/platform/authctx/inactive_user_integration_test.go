//go:build integration

package authctx_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestInactiveAccountCannotUseExistingSession(t *testing.T) {
	for _, tc := range []struct {
		name, mutation string
		status         int
	}{
		{"active", "", http.StatusNoContent},
		{"disabled after login", "UPDATE auth.users SET disabled_at=NOW() WHERE id=$1", http.StatusUnauthorized},
		{"deleted after login", "DELETE FROM auth.users WHERE id=$1", http.StatusUnauthorized},
		{"revoked session", "UPDATE auth.sessions SET revoked_at=NOW() WHERE user_id=$1", http.StatusUnauthorized},
		{"expired session", "UPDATE auth.sessions SET expires_at=NOW()-interval '1 second' WHERE user_id=$1", http.StatusUnauthorized},
		{"previous generation", "UPDATE auth.users SET token_generation=token_generation+1 WHERE id=$1", http.StatusUnauthorized},
		{"database unavailable", "", http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := dbtest.Postgres(t)
			const id = "11111111-0410-4410-8410-111111111111"
			dbtest.User(t, db, id, "generation-test")
			cryptoServer := startIntegrationCryptoServer(t)
			crypto := cryptoclient.NewClient(cryptoServer.URL)
			token := loginIntegrationToken(t, auth.NewService(db, crypto))
			if tc.mutation != "" {
				_, err := db.Exec(tc.mutation, id)
				require.NoError(t, err)
			}
			if tc.name == "database unavailable" {
				require.NoError(t, db.Close())
			}
			called := false
			handler := authctx.Middleware(crypto, authctx.NewDBTokenChecker(db))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(http.StatusNoContent) }))
			// The shared guard must reject the credential before a domain handler runs.
			r := httptest.NewRequest(http.MethodGet, "/api/v2/auth/sessions", nil)
			r.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: token})
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.Equal(t, tc.status == http.StatusNoContent, called)
			if tc.status == http.StatusUnauthorized {
				require.Contains(t, w.Body.String(), "token_revoked")
			}
			if tc.status == http.StatusServiceUnavailable {
				require.Contains(t, w.Body.String(), "auth_check_unavailable")
			}

			ws := chat.NewWSServer(db, crypto, nil)
			t.Cleanup(ws.Close)
			server := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
			t.Cleanup(server.Close)
			want := tc.status
			if want == http.StatusNoContent {
				want = http.StatusSwitchingProtocols
			}
			assertWebSocketHandshakeStatus(t, server.URL, token, want)
			// Disabling is an account state check, not a destructive rewrite of sessions.
			if tc.name == "disabled after login" {
				_, err := db.Exec("UPDATE auth.users SET disabled_at=NULL WHERE id=$1", id)
				require.NoError(t, err)
				assertAuthenticatedHTTPStatus(t, handler, token, http.StatusNoContent)
				assertWebSocketHandshakeStatus(t, server.URL, token, http.StatusSwitchingProtocols)
			}
		})
	}
}
