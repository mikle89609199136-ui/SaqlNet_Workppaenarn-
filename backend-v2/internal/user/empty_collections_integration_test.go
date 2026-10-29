//go:build integration

package user

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

func TestUserCollectionsHTTP(t *testing.T) {
	db := dbtest.Postgres(t)
	dbtest.User(t, db, settingsOwner, "collections_owner")
	const peer = "73000000-0000-4000-8000-000000000002"
	dbtest.User(t, db, peer, "collections_peer")
	svc := NewService(db)
	h := NewHandler(svc, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/users/search", h.Search)
	mux.HandleFunc("/api/v2/users/blocked", h.Blocked)
	mux.HandleFunc("/api/v2/users/export", h.Export)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Авторизация покрыта отдельно; проверяем HTTP → handler → реальный PostgreSQL.
		mux.ServeHTTP(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: settingsOwner})))
	}))
	t.Cleanup(server.Close)
	api := settingsAPI{db: db, server: server}
	for _, tc := range []struct{ path, key string }{
		{"search?q=unique_no_match_435", "users"}, {"search?q=", "users"},
		{"blocked", "blocked"}, {"export", "chats"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			got := api.request(t, http.MethodGet, tc.path, "", http.StatusOK)
			require.Equal(t, []any{}, got[tc.key])
			if tc.key == "chats" {
				require.Equal(t, []any{}, got["user"].(map[string]any)["badges"])
			}
		})
	}
	avatar := "https://example.com/avatar.png"
	_, err := svc.UpdateProfile(t.Context(), peer, nil, nil, nil, &avatar)
	require.NoError(t, err)
	for _, rule := range []string{"all", "nobody"} {
		_, err = svc.UpdatePrivacy(t.Context(), peer, map[string]any{"photoVisibility": rule})
		require.NoError(t, err)
		got := api.request(t, http.MethodGet, "search?q=collections_peer", "", http.StatusOK)
		users := got["users"].([]any)
		require.Len(t, users, 1)
		expectedAvatar := avatar
		if rule == "nobody" {
			expectedAvatar = ""
		}
		require.Equal(t, peer, users[0].(map[string]any)["id"])
		require.Equal(t, expectedAvatar, users[0].(map[string]any)["avatarUrl"])
	}
	require.NoError(t, svc.Block(t.Context(), settingsOwner, peer))
	got := api.request(t, http.MethodGet, "blocked", "", http.StatusOK)
	blocked := got["blocked"].([]any)
	require.Len(t, blocked, 1)
	require.Equal(t, peer, blocked[0].(map[string]any)["id"])
	require.Equal(t, "", blocked[0].(map[string]any)["avatarUrl"])
	require.NoError(t, svc.Unblock(t.Context(), settingsOwner, peer))
	require.Equal(t, []any{}, api.request(t, http.MethodGet, "blocked", "", http.StatusOK)["blocked"])
	var chatID string
	require.NoError(t, db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'Export test', $1) RETURNING id::text`, settingsOwner).Scan(&chatID))
	_, err = db.Exec(`INSERT INTO chats.members (chat_id, user_id) VALUES ($1, $2)`, chatID, settingsOwner)
	require.NoError(t, err)
	chats := api.request(t, http.MethodGet, "export", "", http.StatusOK)["chats"].([]any)
	require.Len(t, chats, 1)
	require.Equal(t, chatID, chats[0].(map[string]any)["id"])
	_, err = db.Exec(`DELETE FROM chats.members WHERE chat_id=$1 AND user_id=$2`, chatID, settingsOwner)
	require.NoError(t, err)
	require.Equal(t, []any{}, api.request(t, http.MethodGet, "export", "", http.StatusOK)["chats"])
}
