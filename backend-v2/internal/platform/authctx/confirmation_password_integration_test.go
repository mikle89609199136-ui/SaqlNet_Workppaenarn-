//go:build integration

package authctx_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

type wrongConfirmationCrypto struct{ *cryptoclient.Client }

func (wrongConfirmationCrypto) VerifyPassword(context.Context, string, string) (bool, error) {
	return false, nil
}

func TestWrongConfirmationPasswordPreservesAuthenticatedSession(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "42800000-0000-4000-8000-000000000001"
	dbtest.User(t, db, owner, "generation-test")
	_, err := db.Exec("UPDATE auth.users SET two_fa_enabled=TRUE,two_fa_hash='secondary-hash' WHERE id=$1", owner)
	require.NoError(t, err)
	crypto := cryptoclient.NewClient(startIntegrationCryptoServer(t).URL)
	// Обычный login без 2FA challenge не нужен для этой проверки middleware.
	issued, err := crypto.IssueToken(t.Context(), owner, "generation-test", 0)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO auth.sessions(user_id,access_token_hash,token_generation,expires_at)
 VALUES($1,$2,0,$3)`, owner, authctx.TokenHash(issued.Token), issued.ExpiresAt)
	require.NoError(t, err)
	h := auth.NewHandler(auth.NewService(db, wrongConfirmationCrypto{crypto}))
	mux := http.NewServeMux()
	mux.HandleFunc("/change-password", h.ChangePassword)
	mux.HandleFunc("/2fa/disable", h.TwoFADisable)
	mux.HandleFunc("/2fa/verify", h.TwoFAVerify)
	mux.HandleFunc("/sessions", h.Sessions)
	server := httptest.NewServer(authctx.Middleware(crypto, authctx.NewDBTokenChecker(db))(mux))
	defer server.Close()
	request := func(path, token string, status int, code string) {
		t.Helper()
		method := http.MethodPost
		if path == "/sessions" {
			method = http.MethodGet
		}
		req, err := http.NewRequest(method, server.URL+path, strings.NewReader(`{"currentPassword":"wrong","newPassword":"Password2!","password":"wrong"}`))
		require.NoError(t, err)
		if token != "" {
			req.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: token})
		}
		res, err := server.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		var body map[string]any
		require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
		require.Equal(t, status, res.StatusCode, body)
		if code != "" {
			require.Equal(t, code, body["code"])
		}
		require.Empty(t, res.Cookies(), "неверный пароль подтверждения не должен менять cookie")
	}
	var before string
	require.NoError(t, db.QueryRow("SELECT to_jsonb(u)::text FROM auth.users u WHERE id=$1", owner).Scan(&before))
	for _, path := range []string{"/change-password", "/2fa/disable", "/2fa/verify"} {
		request(path, issued.Token, http.StatusForbidden, "wrong_password")
		request("/sessions", issued.Token, http.StatusOK, "")
		request(path, "", http.StatusUnauthorized, "missing_token")
	}
	var after string
	require.NoError(t, db.QueryRow("SELECT to_jsonb(u)::text FROM auth.users u WHERE id=$1", owner).Scan(&after))
	require.Equal(t, before, after, "неверное подтверждение не меняет пароли и настройки 2FA")
	_, err = db.Exec("UPDATE auth.sessions SET revoked_at=NOW() WHERE user_id=$1", owner)
	require.NoError(t, err)
	request("/2fa/verify", issued.Token, http.StatusUnauthorized, "token_revoked")
}
