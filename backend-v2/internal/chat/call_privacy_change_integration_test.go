//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/privacy"
	"craneapp/backend-v2/internal/user"
	"github.com/gorilla/websocket"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestCallPrivacyCommittedInvalidationsReachPeerWS(t *testing.T) {
	db, url := dbtest.PostgresURL(t)
	const owner = "10560000-0000-4000-8000-000000000001"
	const peer = "10560000-0000-4000-8000-000000000002"
	const stranger = "10560000-0000-4000-8000-000000000003"
	for id, name := range map[string]string{owner: "calls_owner", peer: "calls_peer", stranger: "calls_stranger"} {
		dbtest.User(t, db, id, name)
	}
	svc := NewService(db, nil, nil)
	chatID, _, err := svc.CreatePrivate(t.Context(), owner, peer)
	require.NoError(t, err)
	users := user.NewService(db)
	_, err = users.UpdatePrivacy(t.Context(), owner, map[string]any{"calls": "all"})
	require.NoError(t, err)
	// Повторный прогон миграции не меняет результат и не падает.
	migration, err := os.ReadFile("../../migrations/0048_call_privacy_changed.sql")
	require.NoError(t, err)
	_, err = db.Exec(string(migration))
	require.NoError(t, err)
	listener := pq.NewListener(url, 10*time.Millisecond, time.Second, nil)
	defer listener.Close()
	require.NoError(t, listener.Listen(callPrivacyChannel))
	noEvent := func() {
		t.Helper()
		select {
		case e := <-listener.Notify:
			t.Fatalf("unexpected event: %+v", e)
		case <-time.After(100 * time.Millisecond):
		}
	}
	tx, err := db.Begin()
	require.NoError(t, err)
	_, err = tx.Exec(`UPDATE users.settings SET privacy_settings='{"calls":"nobody"}' WHERE user_id=$1`, owner)
	require.NoError(t, err)
	noEvent()
	require.NoError(t, tx.Rollback())
	noEvent()
	tx, err = db.Begin()
	require.NoError(t, err)
	_, err = tx.Exec(`UPDATE users.settings SET privacy_settings='{"calls":"nobody"}' WHERE user_id=$1`, owner)
	require.NoError(t, err)
	_, err = tx.Exec("SELECT 1/0")
	require.Error(t, err)
	require.Error(t, tx.Commit())
	noEvent()
	// Настоящий WS с действующей сессией, плюс настоящий LISTEN relay.
	verifier := revocationVerifier{}
	for _, id := range []string{owner, peer, stranger} {
		verifier[id] = cryptoclient.TokenClaims{Subject: id, Expires: time.Now().Add(time.Hour).Unix()}
		_, err = db.Exec(`INSERT INTO auth.sessions(user_id,access_token_hash,expires_at) VALUES($1,$2,NOW()+interval '1 hour')`, id, authctx.TokenHash(id))
		require.NoError(t, err)
	}
	ws := NewWSServer(db, verifier, nil)
	ws.activity = nil
	ws.pingInterval = time.Hour
	server := httptest.NewServer(http.HandlerFunc(ws.ServeWS))
	defer server.Close()
	defer ws.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); CallPrivacyChangeRelay(ctx, url, db, ws) }()
	defer func() { cancel(); <-done }()
	require.Eventually(t, func() bool {
		var n int
		err := db.QueryRow(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'LISTEN%' AND query LIKE '%crane_call_privacy_changed%'`).Scan(&n)
		return err == nil && n == 2
	}, 5*time.Second, 10*time.Millisecond)
	t.Setenv("ALLOWED_ORIGINS", server.URL)
	connect := func(id string) *websocket.Conn {
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), http.Header{"Origin": {server.URL}, "Cookie": {authctx.SessionCookieName() + "=" + id}})
		require.NoError(t, err)
		return c
	}
	socket := connect(peer)
	defer socket.Close()
	outsider := connect(stranger)
	defer outsider.Close()
	require.Eventually(t, func() bool { return ws.IsUserConnected(peer) && ws.IsUserConnected(stranger) }, time.Second, time.Millisecond)
	for _, write := range []func() error{
		func() error {
			_, err := users.UpdatePrivacy(t.Context(), owner, map[string]any{"calls": "nobody"})
			return err
		},
		func() error {
			_, err := users.SetPrivacyException(t.Context(), owner, privacy.Calls, peer, true)
			return err
		},
		func() error {
			_, err := users.SetPrivacyException(t.Context(), owner, privacy.Calls, peer, false)
			return err
		},
		func() error { return users.RemovePrivacyException(t.Context(), owner, privacy.Calls, peer) },
		func() error {
			return users.UpdateAllSettings(t.Context(), owner, user.AllSettings{PrivacySettings: map[string]any{"calls": "all"}})
		},
	} {
		require.NoError(t, write())
		select {
		case event := <-listener.Notify:
			var payload map[string]any
			require.NoError(t, json.Unmarshal([]byte(event.Extra), &payload))
			require.Equal(t, map[string]any{"userId": owner}, payload)
		case <-time.After(3 * time.Second):
			t.Fatal("no committed notification")
		}
		require.NoError(t, socket.SetReadDeadline(time.Now().Add(3*time.Second)))
		var event map[string]any
		require.NoError(t, socket.ReadJSON(&event))
		require.Equal(t, map[string]any{"type": "chat_updated", "chatId": chatID}, event)
	}
	// Ни чужие settings, ни исключения не уходят неучаствующему пользователю.
	require.NoError(t, outsider.SetReadDeadline(time.Now().Add(100*time.Millisecond)))
	_, _, err = outsider.ReadMessage()
	require.Error(t, err)
	_, err = users.UpdatePrivacy(t.Context(), owner, map[string]any{"photoVisibility": "nobody"})
	require.NoError(t, err)
	noEvent()
}

func TestCanCallFalseForSelfAndGroup(t *testing.T) {
	db := dbtest.Postgres(t)
	const id = "10560000-0000-4000-8000-000000000099"
	dbtest.User(t, db, id, "self_calls")
	service := NewService(db, nil, nil)
	selfID, _, err := service.CreatePrivate(t.Context(), id, id)
	require.NoError(t, err)
	self, err := service.Get(t.Context(), id, selfID)
	require.NoError(t, err)
	require.False(t, self.CanCall)
	groupID, err := service.CreateGroup(t.Context(), id, "Group", "", "", nil)
	require.NoError(t, err)
	group, err := service.Get(t.Context(), id, groupID)
	require.NoError(t, err)
	require.False(t, group.CanCall)
}
