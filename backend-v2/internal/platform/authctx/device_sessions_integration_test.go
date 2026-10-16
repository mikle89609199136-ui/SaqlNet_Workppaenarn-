//go:build integration

package authctx_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/user"
	"github.com/stretchr/testify/require"
)

// Exercise both public APIs with real session state and identical user agents.
func TestCanonicalSessionsAcrossDeviceAPIs(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "11111111-0706-4706-8706-111111111111"
	dbtest.User(t, db, owner, "generation-test")
	crypto := cryptoclient.NewClient(startIntegrationCryptoServer(t).URL)
	service := auth.NewService(db, crypto)
	users := user.NewService(db)
	authHandler := auth.NewHandler(service, auth.WithLogoutAllGenerationEnabled(true))
	userHandler := user.NewHandler(users, nil)
	middleware := authctx.Middleware(crypto, authctx.NewDBTokenChecker(db))
	request := func(method, path, token, body string, endpoint http.HandlerFunc) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: token})
		response := httptest.NewRecorder()
		middleware(endpoint).ServeHTTP(response, req)
		return response
	}
	first := loginIntegrationToken(t, service)
	second := loginIntegrationToken(t, service)
	register := func(token, name string) string {
		t.Helper()
		response := request(http.MethodPost, "/api/v2/users/devices/register", token,
			`{"deviceName":"`+name+`","deviceType":"desktop","userAgent":"SameBrowser/1.0","clientIP":"203.0.113.7"}`, userHandler.RegisterDevice)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var body struct {
			SessionID string `json:"sessionId"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		return body.SessionID
	}
	firstID := register(first, "First")
	secondID := register(second, "Second")
	require.NotEqual(t, firstID, secondID)
	require.Equal(t, firstID, register(first, "First updated"))
	for _, token := range []string{first, second} {
		a := request(http.MethodGet, "/api/v2/auth/sessions", token, "", authHandler.Sessions)
		b := request(http.MethodGet, "/api/v2/users/devices", token, "", userHandler.Devices)
		require.Equal(t, http.StatusOK, a.Code)
		require.Equal(t, http.StatusOK, b.Code)
		var sessions struct {
			Sessions []auth.Session `json:"sessions"`
		}
		var devices struct {
			Devices []user.Session `json:"devices"`
		}
		require.NoError(t, json.Unmarshal(a.Body.Bytes(), &sessions))
		require.NoError(t, json.Unmarshal(b.Body.Bytes(), &devices))
		require.Len(t, sessions.Sessions, 2)
		require.Len(t, devices.Devices, 2)
		require.True(t, sessions.Sessions[0].IsCurrent)
		require.True(t, devices.Devices[0].IsCurrent)
		require.False(t, sessions.Sessions[1].IsCurrent)
		require.False(t, devices.Devices[1].IsCurrent)
		for i := range sessions.Sessions {
			require.Equal(t, sessions.Sessions[i].ID, devices.Devices[i].ID)
		}
	}
	const otherOwner = "22222222-0706-4706-8706-222222222222"
	dbtest.User(t, db, otherOwner, "other_owner")
	var foreignID string
	require.NoError(t, db.QueryRow(`INSERT INTO auth.sessions (user_id, access_token_hash, expires_at) VALUES ($1, 'foreign-hash', NOW() + INTERVAL '1 hour') RETURNING id::text`, otherOwner).Scan(&foreignID))
	foreignResponse := request(http.MethodDelete, "/api/v2/users/devices/"+foreignID, first, "", userHandler.DeleteDevice)
	require.Equal(t, http.StatusNotFound, foreignResponse.Code)
	// Caller-relative current session and ownership checks.
	response := request(http.MethodDelete, "/api/v2/users/devices/"+firstID, first, "", userHandler.DeleteDevice)
	require.Equal(t, http.StatusConflict, response.Code)
	response = request(http.MethodDelete, "/api/v2/users/devices/99999999-0706-4706-8706-999999999999", first, "", userHandler.DeleteDevice)
	require.Equal(t, http.StatusNotFound, response.Code)
	before, err := users.Devices(t.Context(), owner, first)
	require.NoError(t, err)
	response = request(http.MethodDelete, "/api/v2/users/devices/"+secondID, first, "", userHandler.DeleteDevice)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	after, err := users.Devices(t.Context(), owner, first)
	require.NoError(t, err)
	require.Equal(t, before[:1], after, "revoking another session must preserve the caller's entire metadata")
	response = request(http.MethodGet, "/api/v2/auth/sessions", second, "", authHandler.Sessions)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	_, err = users.RegisterDevice(t.Context(), owner, authctx.TokenHash(second), "overwrite", "mobile", "", "", "SameBrowser/1.0")
	require.ErrorIs(t, err, user.ErrAuthSessionInactive)
	// Terminate other sessions, including ones never explicitly registered.
	third := loginIntegrationToken(t, service)
	response = request(http.MethodPost, "/api/v2/users/devices/terminate-all", first, "", userHandler.TerminateAllDevices)
	require.Equal(t, http.StatusOK, response.Code)
	response = request(http.MethodGet, "/api/v2/auth/sessions", third, "", authHandler.Sessions)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	response = request(http.MethodPost, "/api/v2/auth/logout-all", first, "", authHandler.LogoutAll)
	require.Equal(t, http.StatusOK, response.Code)
	response = request(http.MethodGet, "/api/v2/auth/sessions", first, "", authHandler.Sessions)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	var legacyCount int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM public.user_sessions WHERE user_id = $1`, owner).Scan(&legacyCount))
	require.Zero(t, legacyCount, "no runtime dual writes")
}

func TestSessionCheckerRequiresAnActiveOwnedCredential(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "11111111-0706-4706-8706-111111111111"
	const other = "22222222-0706-4706-8706-222222222222"
	dbtest.User(t, db, owner, "checker_owner")
	dbtest.User(t, db, other, "checker_other")
	checker := authctx.NewDBTokenChecker(db)
	for _, tc := range []struct {
		token, sessionOwner           string
		generation                    int64
		revoked, expired, wantRevoked bool
	}{
		{token: "unknown", wantRevoked: true},
		{token: "active", sessionOwner: owner},
		{token: "wrong-owner", sessionOwner: other, wantRevoked: true},
		{token: "revoked", sessionOwner: owner, revoked: true, wantRevoked: true},
		{token: "expired", sessionOwner: owner, expired: true, wantRevoked: true},
		{token: "wrong-generation", sessionOwner: owner, generation: 1, wantRevoked: true},
	} {
		t.Run(tc.token, func(t *testing.T) {
			if tc.sessionOwner != "" {
				_, err := db.Exec(`INSERT INTO auth.sessions (user_id, access_token_hash, token_generation, expires_at, revoked_at)
     VALUES ($1, $2, $3, CASE WHEN $4 THEN NOW() - INTERVAL '1 second' ELSE NOW() + INTERVAL '1 hour' END,
      CASE WHEN $5 THEN NOW() ELSE NULL END)`, tc.sessionOwner, authctx.TokenHash(tc.token), tc.generation, tc.expired, tc.revoked)
				require.NoError(t, err)
			}
			revoked, err := checker.IsTokenRevoked(t.Context(), tc.token, cryptoclient.TokenClaims{Subject: owner})
			require.NoError(t, err)
			require.Equal(t, tc.wantRevoked, revoked)
		})
	}
}
