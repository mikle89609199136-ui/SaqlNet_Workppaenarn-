//go:build integration

package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestPersonalMuteHTTPAndPersistenceOnRealSchema(t *testing.T) {
	const (
		me       = "55900000-0000-4000-8000-000000000001"
		peer     = "55900000-0000-4000-8000-000000000002"
		outsider = "55900000-0000-4000-8000-000000000003"
	)
	db := dbtest.Postgres(t)
	for id, name := range map[string]string{me: "mute_me", peer: "mute_peer", outsider: "mute_outsider"} {
		dbtest.User(t, db, id, name)
	}
	ctx := context.Background()
	svc := NewService(db, nil, nil)
	privateID, _, err := svc.CreatePrivate(ctx, me, peer)
	require.NoError(t, err)
	groupID, err := svc.CreateGroup(ctx, me, "Mute group", "", "", []string{peer})
	require.NoError(t, err)
	h := NewHandler(svc)
	// Проверяем живой HTTP → handler → PostgreSQL. Auth middleware отдельно;
	// тестовый заголовок здесь выбирает уже аутентифицированного владельца.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: r.Header.Get("X-Test-User")}))
		h.Chat(w, r)
	}))
	defer server.Close()
	request := func(method, actor, chatID, body string, status int) map[string]any {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+"/api/v2/chats/"+chatID+"/mute", bytes.NewBufferString(body))
		require.NoError(t, err)
		req.Header.Set("X-Test-User", actor)
		req.Header.Set("Content-Type", "application/json")
		res, err := server.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		require.Equal(t, status, res.StatusCode, string(data))
		var out map[string]any
		require.NoError(t, json.Unmarshal(data, &out))
		return out
	}
	for _, chatID := range []string{privateID, groupID} {
		before, err := svc.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.False(t, before.IsMuted)
		require.Empty(t, before.MutedUntil)
		require.NoError(t, svc.SetFlag(ctx, me, chatID, "pin", true))
		require.NoError(t, svc.SetFlag(ctx, me, chatID, "archive", true))
		require.NoError(t, svc.SetNotificationPreview(ctx, me, chatID, true))
		request("POST", outsider, chatID, `{}`, 403)
		request("DELETE", outsider, chatID, ``, 403)
		var count int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM chats.user_chat_settings WHERE user_id=$1`, outsider).Scan(&count))
		require.Zero(t, count)

		// Два повторных запроса, затем другой экземпляр сервиса/устройство.
		request("POST", me, chatID, `{}`, 200)
		request("POST", me, chatID, `{"mutedUntil":null}`, 200)
		_, err = db.Exec(`INSERT INTO messages.messages(chat_id,sender_id,content) VALUES($1,$2,'opaque-ciphertext')`, chatID, peer)
		require.NoError(t, err)
		otherDevice := NewService(db, nil, nil)
		mine, err := otherDevice.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.True(t, mine.IsMuted)
		require.Empty(t, mine.MutedUntil)
		require.True(t, mine.IsPinned)
		require.True(t, mine.IsArchived)
		require.True(t, mine.HideNotificationPreview)
		require.Equal(t, 1, mine.UnreadCount, "mute не скрывает сообщения и не сбрасывает unread")
		theirs, err := otherDevice.Get(ctx, peer, chatID)
		require.NoError(t, err)
		require.False(t, theirs.IsMuted)
		archived, err := otherDevice.List(ctx, me, true)
		require.NoError(t, err)
		found := false
		for _, item := range archived {
			if item.ID == chatID {
				found = true
				require.True(t, item.IsMuted)
				require.Equal(t, 1, item.UnreadCount)
			}
		}
		require.True(t, found)

		until := time.Now().Add(8 * time.Hour).UTC().Truncate(time.Microsecond)
		request("POST", me, chatID, `{"mutedUntil":"`+until.Format(time.RFC3339Nano)+`"}`, 200)
		mine, err = svc.Get(ctx, me, chatID)
		require.NoError(t, err)
		parsed, err := time.Parse(time.RFC3339Nano, mine.MutedUntil)
		require.NoError(t, err)
		require.True(t, until.Equal(parsed))
		request("POST", me, chatID, `{"mutedUntil":"bad"}`, 400)
		mine, err = svc.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.True(t, mine.IsMuted)
		// Истечение проверяется без Sleep: оба чтения вычисляют effective state.
		_, err = db.Exec(`UPDATE chats.user_chat_settings SET notifications_muted_until=NOW()-interval '1 second'
			WHERE user_id=$1 AND chat_id=$2`, me, chatID)
		require.NoError(t, err)
		mine, err = svc.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.False(t, mine.IsMuted)
		require.Empty(t, mine.MutedUntil)
		archived, err = svc.List(ctx, me, true)
		require.NoError(t, err)
		for _, item := range archived {
			if item.ID == chatID {
				require.False(t, item.IsMuted)
			}
		}
		request("POST", me, chatID, `{}`, 200)
		request("DELETE", me, chatID, ``, 200)
		request("DELETE", me, chatID, ``, 200)
		mine, err = svc.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.False(t, mine.IsMuted)
		require.True(t, mine.HideNotificationPreview)
		require.Equal(t, 1, mine.UnreadCount)
		// Модераторский mute остаётся независимым.
		var moderatorMuted bool
		require.NoError(t, db.QueryRow(`SELECT muted_at IS NOT NULL FROM chats.members WHERE chat_id=$1 AND user_id=$2`, chatID, me).Scan(&moderatorMuted))
		require.False(t, moderatorMuted)
	}
	request("POST", me, nonExistentChatID, `{}`, 403)
	_, err = db.Exec(`CREATE FUNCTION fail_personal_mute() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected mute failure'; END $$;
		CREATE TRIGGER fail_personal_mute BEFORE UPDATE ON chats.user_chat_settings
		FOR EACH ROW EXECUTE FUNCTION fail_personal_mute()`)
	require.NoError(t, err)
	payload := request("POST", me, privateID, `{}`, 500)
	require.Equal(t, "internal_error", payload["code"])
	mine, err := svc.Get(ctx, me, privateID)
	require.NoError(t, err)
	require.False(t, mine.IsMuted)
}
