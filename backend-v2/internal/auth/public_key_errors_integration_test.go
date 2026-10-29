//go:build integration

package auth

import (
	"context"
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

func TestPublicKeyHTTPDatabaseFailureAndRecovery(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "41800000-0000-4000-8000-000000000001"
	dbtest.User(t, db, owner, "key_owner")
	h := NewHandler(NewService(db, handlerCryptoStub{}))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if r.Header.Get("X-Test-Timeout") == "true" {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, 150*time.Millisecond)
			defer cancel()
		}
		h.PublicKey(w, r.WithContext(authctx.WithUser(ctx, authctx.User{ID: owner})))
	}))
	defer server.Close()
	send := func(key string, status int) {
		t.Helper()
		body, err := json.Marshal(map[string]string{"publicKey": key})
		require.NoError(t, err)
		req, err := http.NewRequest(http.MethodPost, server.URL, strings.NewReader(string(body)))
		require.NoError(t, err)
		req.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "unchanged-session"})
		if key == "timed-out-key" {
			req.Header.Set("X-Test-Timeout", "true")
		}
		res, err := server.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		require.Equal(t, status, res.StatusCode, string(data))
		require.Empty(t, res.Cookies(), "ошибка сохранения ключа не должна удалять cookie")
		if status == 500 {
			require.JSONEq(t, `{"code":"internal_error","message":"failed to save public key"}`, string(data))
		}
	}
	snapshot := func() string {
		var raw string
		require.NoError(t, db.QueryRow("SELECT to_jsonb(k)::text FROM auth.public_keys k WHERE user_id=$1", owner).Scan(&raw))
		return raw
	}
	send("original-key", 200)
	before := snapshot()
	send(" \t", 400)
	require.Equal(t, before, snapshot())
	// Настоящий отказ записи в изолированной тестовой БД, включая секретные детали.
	_, err := db.Exec(`CREATE FUNCTION auth.reject_test_public_key() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'postgres://secret@127.0.0.1:5998 SQL INSERT INTO auth.public_keys'; END $$;
 CREATE TRIGGER reject_test_public_key BEFORE INSERT OR UPDATE ON auth.public_keys
 FOR EACH ROW EXECUTE FUNCTION auth.reject_test_public_key()`)
	require.NoError(t, err)
	send("must-not-be-written", 500)
	require.Equal(t, before, snapshot())
	_, err = db.Exec("DROP TRIGGER reject_test_public_key ON auth.public_keys")
	require.NoError(t, err)
	// SELECT пользователя блокируется до истечения реального deadline запроса.
	tx, err := db.Begin()
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.Exec("LOCK TABLE auth.users IN ACCESS EXCLUSIVE MODE")
	require.NoError(t, err)
	send("timed-out-key", 500)
	require.NoError(t, tx.Rollback())
	require.Equal(t, before, snapshot())
	send("recovered-key", 200)
	var key string
	require.NoError(t, db.QueryRow("SELECT public_key FROM auth.public_keys WHERE user_id=$1", owner).Scan(&key))
	require.Equal(t, "recovered-key", key)
	_, err = db.Exec("DELETE FROM auth.users WHERE id=$1", owner)
	require.NoError(t, err)
	send("missing-user-key", 401)
}
