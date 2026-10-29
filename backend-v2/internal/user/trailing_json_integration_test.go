//go:build integration

package user

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/profileevent"
	"craneapp/backend-v2/internal/platform/settingsevent"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestTrailingJSONDoesNotMutateOrNotify(t *testing.T) {
	db, url := dbtest.PostgresURL(t)
	dbtest.User(t, db, settingsOwner, "trailing_json_owner")
	const peer = "73000000-0000-4000-8000-000000000002"
	dbtest.User(t, db, peer, "trailing_json_peer")
	svc := NewService(db)
	require.NoError(t, svc.ensureSettings(context.Background(), settingsOwner))
	name := "Before"
	_, err := svc.UpdateProfile(context.Background(), settingsOwner, &name, nil, nil, nil)
	require.NoError(t, err)
	snapshot := func() string {
		t.Helper()
		var state string
		require.NoError(t, db.QueryRow(`SELECT jsonb_build_object(
   'settings', (SELECT to_jsonb(s) FROM users.settings s WHERE user_id=$1),
   'profile', (SELECT to_jsonb(p) FROM users.profiles p WHERE user_id=$1),
   'exceptions', (SELECT jsonb_agg(e) FROM users.privacy_exceptions e WHERE owner_id=$1)
  )::text`, settingsOwner).Scan(&state))
		return state
	}
	before := snapshot()
	listener := pq.NewListener(url, 10*time.Millisecond, time.Second, nil)
	t.Cleanup(func() { _ = listener.Close() })
	for _, channel := range []string{settingsevent.Channel, profileevent.Channel, "crane_call_privacy_changed"} {
		require.NoError(t, listener.Listen(channel))
	}
	h := NewHandler(svc, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/users/me", h.Me)
	mux.HandleFunc("/api/v2/users/settings", h.Settings)
	mux.HandleFunc("/api/v2/users/all-settings", h.AllSettings)
	mux.HandleFunc("/api/v2/users/privacy", h.Privacy)
	mux.HandleFunc("/api/v2/users/privacy/exceptions/", h.PrivacyExceptions)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: settingsOwner})))
	}))
	t.Cleanup(server.Close)
	for _, tc := range []struct{ path, body string }{
		{"me", `{"firstName":"After"}`},
		{"settings", `{"theme":"light"}`},
		{"all-settings", `{"settings":{"theme":"light"},"privacySettings":{"calls":"nobody"}}`},
		{"privacy", `{"calls":"nobody"}`},
		{"privacy/exceptions/calls/" + peer, `{"mode":"allow"}`},
	} {
		for _, suffix := range []string{` {}`, ` null`, ` 1`, ` garbage`} {
			req, err := http.NewRequest(http.MethodPut, server.URL+"/api/v2/users/"+tc.path, strings.NewReader(tc.body+suffix))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			response, err := server.Client().Do(req)
			require.NoError(t, err)
			var body map[string]any
			err = json.NewDecoder(response.Body).Decode(&body)
			require.NoError(t, response.Body.Close())
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, response.StatusCode, tc.path+suffix)
			require.Equal(t, "invalid_json", body["code"])
			require.Equal(t, before, snapshot(), tc.path+suffix)
		}
	}
	select {
	case event := <-listener.Notify:
		t.Fatalf("отклонённый запрос создал событие: %+v", event)
	case <-time.After(150 * time.Millisecond):
	}
	// Контроль: валидный запрос с whitespace сохраняется и создаёт событие.
	req, err := http.NewRequest(http.MethodPut, server.URL+"/api/v2/users/settings", strings.NewReader("{\"theme\":\"light\"}\n\t "))
	require.NoError(t, err)
	response, err := server.Client().Do(req)
	require.NoError(t, err)
	require.NoError(t, response.Body.Close())
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.NotEqual(t, before, snapshot())
	select {
	case event := <-listener.Notify:
		require.NotNil(t, event)
		require.Equal(t, settingsevent.Channel, event.Channel)
	case <-time.After(3 * time.Second):
		t.Fatal("валидный запрос не создал событие")
	}
}
