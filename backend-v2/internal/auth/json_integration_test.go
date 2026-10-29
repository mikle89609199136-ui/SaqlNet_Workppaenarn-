//go:build integration

package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestAuthJSONHTTPRejectsTrailingDataWithoutDatabaseWrites(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "41700000-0000-4000-8000-000000000001"
	dbtest.User(t, db, owner, "json_owner")
	h := NewHandler(NewService(db, handlerCryptoStub{verifyResult: true}))
	endpoints := authJSONEndpoints(h)
	mux := http.NewServeMux()
	for _, endpoint := range endpoints {
		mux.HandleFunc("/"+endpoint.name, endpoint.serve)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("token", "existing")
		mux.ServeHTTP(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: owner})))
	}))
	defer server.Close()
	snapshot := func() string {
		var data string
		require.NoError(t, db.QueryRow(`SELECT json_build_array(
   (SELECT json_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),
   (SELECT json_agg(to_jsonb(p) ORDER BY user_id) FROM users.profiles p),
   (SELECT json_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s),
   (SELECT json_agg(to_jsonb(k) ORDER BY user_id) FROM auth.public_keys k),
   (SELECT count(*) FROM auth.username_registry),
   (SELECT count(*) FROM users.settings))::text`).Scan(&data))
		return data
	}
	send := func(t *testing.T, endpoint authJSONEndpoint, body string) (int, string, []*http.Cookie) {
		t.Helper()
		req, err := http.NewRequest(endpoint.method, server.URL+"/"+endpoint.name, strings.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		res, err := server.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		return res.StatusCode, string(data), res.Cookies()
	}
	for _, endpoint := range endpoints {
		h.qrTokens.Store("existing", &QRTokenData{Secret: "secret", ScannedBy: owner, ExpiresAt: time.Now().Add(time.Hour)})
		h.qrOffers.Store("existing", &QROfferData{OwnerID: owner, ExpiresAt: time.Now().Add(time.Hour), Claimed: endpoint.name == "offer-confirm"})
		for name, body := range invalidAuthBodies(endpoint.body, endpoint.limit) {
			t.Run(endpoint.name+"/"+name, func(t *testing.T) {
				before := snapshot()
				status, data, cookies := send(t, endpoint, body)
				require.Equal(t, http.StatusBadRequest, status, data)
				var payload map[string]any
				require.NoError(t, json.Unmarshal([]byte(data), &payload))
				require.Equal(t, "invalid_json", payload["code"])
				require.Empty(t, cookies)
				require.Equal(t, before, snapshot(), "некорректный JSON не должен менять данные")
			})
		}
		t.Run(endpoint.name+"/trailing-whitespace", func(t *testing.T) {
			status, data, cookies := send(t, endpoint, endpoint.body+" \r\n\t")
			expected := http.StatusOK
			if endpoint.name == "register" {
				expected = http.StatusCreated
			}
			if endpoint.name == "qr-cancel" {
				expected = http.StatusNoContent
			}
			require.Equal(t, expected, status, data)
			if endpoint.name == "register" || endpoint.name == "login" {
				require.NotEmpty(t, cookies, "успешный вход сохраняет cookie-контракт")
			}
		})
	}
	// Подтверждаем реальные побочные эффекты успешных запросов, а не только статус.
	var registered, sessions int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM auth.users WHERE username='json_user'").Scan(&registered))
	require.Equal(t, 1, registered)
	require.NoError(t, db.QueryRow("SELECT count(*) FROM auth.sessions").Scan(&sessions))
	require.Positive(t, sessions)
	var key string
	require.NoError(t, db.QueryRow("SELECT public_key FROM auth.public_keys WHERE user_id=$1", owner).Scan(&key))
	require.Equal(t, qrPublicKey, key)
	var enabled bool
	require.NoError(t, db.QueryRow("SELECT two_fa_enabled FROM auth.users WHERE id=$1", owner).Scan(&enabled))
	require.False(t, enabled)
}
