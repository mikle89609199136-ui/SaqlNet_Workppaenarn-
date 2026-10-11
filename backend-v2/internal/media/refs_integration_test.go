//go:build integration

package media

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/mediarefs"
	"craneapp/backend-v2/internal/user"
	migrationsql "craneapp/backend-v2/migrations"
	"github.com/stretchr/testify/require"
)

func accessUpload(t *testing.T, db *sql.DB, owner string) string {
	t.Helper()
	var id string
	require.NoError(t, db.QueryRow(`INSERT INTO media.uploads (uploader_id, object_key, filename, content_type, size_bytes) VALUES ($1, 'key', 'image.gif', 'image/gif', 4) RETURNING id::text`, owner).Scan(&id))
	return id
}

func TestMediaReferenceWriters(t *testing.T) {
	db := dbtest.Postgres(t)
	ctx := context.Background()
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	const other = "bbbbbbbb-2222-4222-8222-222222222222"
	dbtest.User(t, db, owner, "refs_owner")
	dbtest.User(t, db, other, "refs_other")
	own := accessUpload(t, db, owner)
	foreign := accessUpload(t, db, other)
	ownURL := mediarefs.URLPrefix + own
	users := user.NewService(db)
	chats := chat.NewService(db, nil, nil)
	media := NewService(db, nil, "", 1024)
	assertRefs := func(kind string, want int) {
		t.Helper()
		var count int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM media.upload_refs WHERE kind = $1`, kind).Scan(&count))
		require.Equal(t, want, count)
	}

	for _, invalid := range []string{mediarefs.URLPrefix + foreign, mediarefs.URLPrefix + "bad", mediarefs.URLPrefix + "cccccccc-3333-4333-8333-333333333333"} {
		_, err := users.UpdateProfile(ctx, owner, nil, nil, nil, &invalid)
		require.ErrorIs(t, err, user.ErrInvalidInput)
		_, err = chats.CreateGroup(ctx, owner, "group", "", invalid, nil)
		require.ErrorIs(t, err, chat.ErrInvalidInput)
	}
	assertRefs("avatar", 0)
	assertRefs("chat_avatar", 0)

	_, err := users.UpdateProfile(ctx, owner, nil, nil, nil, &ownURL)
	require.NoError(t, err)
	assertRefs("avatar", 1)
	require.NoError(t, media.CanDownload(ctx, other, own))
	var attachedAt time.Time
	require.NoError(t, db.QueryRow(`SELECT first_attached_at FROM media.uploads WHERE id = $1`, own).Scan(&attachedAt))
	_, err = users.UpdateProfile(ctx, owner, nil, nil, nil, &ownURL)
	require.NoError(t, err)
	assertRefs("avatar", 1)
	var attachedAgain time.Time
	require.NoError(t, db.QueryRow(`SELECT first_attached_at FROM media.uploads WHERE id = $1`, own).Scan(&attachedAgain))
	require.Equal(t, attachedAt, attachedAgain, "replacing the ref must not reset attachment history")

	external := "https://example.org/legacy.png"
	_, err = users.UpdateProfile(ctx, owner, nil, nil, nil, &external)
	require.NoError(t, err)
	assertRefs("avatar", 0)
	require.ErrorIs(t, media.CanDownload(ctx, owner, own), ErrForbidden)

	chatID, err := chats.CreateGroup(ctx, owner, "group", "", ownURL, nil)
	require.NoError(t, err)
	assertRefs("chat_avatar", 1)
	require.NoError(t, media.CanDownload(ctx, other, own))
	foreignURL := mediarefs.URLPrefix + foreign
	_, err = chats.UpdateGroup(ctx, owner, chatID, nil, nil, &foreignURL)
	require.ErrorIs(t, err, chat.ErrInvalidInput)
	assertRefs("chat_avatar", 1)
	cleared := ""
	_, err = chats.UpdateGroup(ctx, owner, chatID, nil, nil, &cleared)
	require.NoError(t, err)
	assertRefs("chat_avatar", 0)
	require.ErrorIs(t, media.CanDownload(ctx, owner, own), ErrForbidden)
	_, err = chats.UpdateGroup(ctx, owner, chatID, nil, nil, &ownURL)
	require.NoError(t, err)
	assertRefs("chat_avatar", 1)

	gifUpload := accessUpload(t, db, owner)
	r := httptest.NewRequest(http.MethodPost, "/api/v2/gifs", strings.NewReader(`{"url":"`+mediarefs.URLPrefix+gifUpload+`"}`))
	r = r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: owner}))
	w := httptest.NewRecorder()
	NewHandler(media).CreateGif(w, r)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	assertRefs("gif", 1)
	require.NoError(t, media.CanDownload(ctx, other, gifUpload))
}

func TestMediaAccessBackfillIsIdempotent(t *testing.T) {
	db := dbtest.Postgres(t)
	ctx := context.Background()
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	dbtest.User(t, db, owner, "backfill_owner")
	gifUpload := accessUpload(t, db, owner)
	avatarUpload := accessUpload(t, db, owner)
	chatUpload := accessUpload(t, db, owner)
	messageUpload := accessUpload(t, db, owner)
	unknown := accessUpload(t, db, owner)
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := db.Exec(`UPDATE media.uploads SET created_at = $1`, created)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO media.gifs (user_id, url, created_at) VALUES ($1, $2, $3)`, owner, mediarefs.URLPrefix+strings.ToUpper(gifUpload), created.Add(2*time.Hour))
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO users.profiles (user_id, first_name, avatar_url) VALUES ($1, 'Owner', $2) ON CONFLICT (user_id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url`, owner, mediarefs.URLPrefix+avatarUpload)
	require.NoError(t, err)
	var chatID string
	require.NoError(t, db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id, avatar_url) VALUES ('group', 'backfill', $1, $2) RETURNING id::text`, owner, mediarefs.URLPrefix+chatUpload).Scan(&chatID))
	for _, id := range []string{messageUpload, gifUpload} {
		_, err = db.Exec(`INSERT INTO messages.messages (chat_id, sender_id, content, metadata, created_at, deleted_at) VALUES ($1, $2, '', jsonb_build_object('mediaUrl', $3::text), $4, NOW())`, chatID, owner, mediarefs.URLPrefix+id, created.Add(time.Hour))
		require.NoError(t, err)
	}
	_, err = db.Exec(`INSERT INTO messages.messages (chat_id, sender_id, content, metadata) VALUES ($1, $2, '', '{"mediaUrl":"/api/v2/media/not-a-uuid"}')`, chatID, owner)
	require.NoError(t, err)
	migration, err := migrationsql.FS.ReadFile("0039_media_access.sql")
	require.NoError(t, err)
	for range 2 {
		_, err = db.Exec(string(migration))
		require.NoError(t, err)
		var count int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM media.upload_refs`).Scan(&count))
		require.Equal(t, 5, count)
		for _, tc := range []struct {
			id, purpose string
			when        time.Time
		}{
			{gifUpload, "message", created.Add(time.Hour)},
			{avatarUpload, "avatar", created},
			{chatUpload, "avatar", created},
			{messageUpload, "message", created.Add(time.Hour)},
		} {
			var purpose string
			var attached time.Time
			require.NoError(t, db.QueryRow(`SELECT purpose, first_attached_at FROM media.uploads WHERE id = $1`, tc.id).Scan(&purpose, &attached))
			require.Equal(t, tc.purpose, purpose)
			require.Equal(t, tc.when, attached)
		}
		var purpose string
		var attached sql.NullTime
		require.NoError(t, db.QueryRow(`SELECT purpose, first_attached_at FROM media.uploads WHERE id = $1`, unknown).Scan(&purpose, &attached))
		require.Equal(t, "unknown", purpose)
		require.False(t, attached.Valid)
	}
	require.ErrorIs(t, NewService(db, nil, "", 1024).CanDownload(ctx, owner, messageUpload), ErrForbidden)
}
