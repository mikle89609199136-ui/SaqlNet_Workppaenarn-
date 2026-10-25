//go:build integration

package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/mediarefs"
	"github.com/stretchr/testify/require"
)

type accessTestAuth struct{}

func (accessTestAuth) VerifyToken(_ context.Context, token string) (cryptoclient.TokenClaims, error) {
	return cryptoclient.TokenClaims{Subject: token, Expires: time.Now().Add(time.Hour).Unix()}, nil
}
func (accessTestAuth) IsTokenRevoked(context.Context, string, cryptoclient.TokenClaims) (bool, error) {
	return false, nil
}

func TestMediaDownloadAccess(t *testing.T) {
	t.Setenv("CRANE_ENV", "development")
	db := dbtest.Postgres(t)
	ctx := context.Background()
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	const member = "bbbbbbbb-2222-4222-8222-222222222222"
	const stranger = "cccccccc-3333-4333-8333-333333333333"
	dbtest.User(t, db, owner, "download_owner")
	dbtest.User(t, db, member, "download_member")
	dbtest.User(t, db, stranger, "download_stranger")
	tests := []struct {
		name, viewer, purpose     string
		kind                      mediarefs.Kind
		left, deleted, secondChat bool
		missing, invalid          bool
		status                    int
	}{
		{name: "anonymous", status: 401},
		{name: "foreign chat", viewer: stranger, kind: mediarefs.Message, status: 403},
		{name: "member", viewer: member, kind: mediarefs.Message, status: 200},
		{name: "former member", viewer: member, kind: mediarefs.Message, left: true, status: 403},
		{name: "sender left", viewer: owner, kind: mediarefs.Message, left: true, status: 403},
		{name: "deleted message sender", viewer: owner, kind: mediarefs.Message, deleted: true, status: 403},
		{name: "deleted message member", viewer: member, kind: mediarefs.Message, deleted: true, status: 403},
		{name: "unattached owner", viewer: owner, purpose: "message", status: 200},
		{name: "unattached stranger", viewer: stranger, purpose: "avatar", status: 403},
		{name: "profile avatar", viewer: stranger, kind: mediarefs.Avatar, status: 200},
		{name: "chat avatar stranger", viewer: stranger, kind: mediarefs.ChatAvatar, status: 403},
		{name: "chat avatar member", viewer: member, kind: mediarefs.ChatAvatar, status: 200},
		{name: "chat avatar former member", viewer: member, kind: mediarefs.ChatAvatar, left: true, status: 403},
		{name: "chat avatar owner left", viewer: owner, kind: mediarefs.ChatAvatar, left: true, status: 403},
		{name: "published GIF", viewer: stranger, kind: mediarefs.Gif, status: 200},
		{name: "unknown owner", viewer: owner, status: 200},
		{name: "unknown stranger", viewer: stranger, status: 403},
		{name: "missing upload", viewer: owner, missing: true, status: 404},
		{name: "invalid upload", viewer: owner, invalid: true, status: 404},
		{name: "two chats first member", viewer: owner, kind: mediarefs.Message, secondChat: true, status: 200},
		{name: "two chats second member", viewer: member, kind: mediarefs.Message, secondChat: true, status: 200},
	}
	for _, tt := range tests {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(tt.name+"/"+method, func(t *testing.T) {
				purpose := tt.purpose
				if purpose == "" {
					purpose = "unknown"
				}
				var uploadID, chatID string
				require.NoError(t, db.QueryRow(`INSERT INTO media.uploads (uploader_id, object_key, filename, content_type, size_bytes, purpose) VALUES ($1, 'private-key', 'secret.png', 'image/png', 4, $2) RETURNING id::text`, owner, purpose).Scan(&uploadID))
				require.NoError(t, db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'access', $1) RETURNING id::text`, owner).Scan(&chatID))
				_, err := db.Exec(`INSERT INTO chats.members (chat_id, user_id) VALUES ($1, $2), ($1, $3)`, chatID, owner, member)
				require.NoError(t, err)
				attachMessage := func(chat string) string {
					var id string
					require.NoError(t, db.QueryRow(`INSERT INTO messages.messages (chat_id, sender_id, content) VALUES ($1, $2, '') RETURNING id::text`, chat, owner).Scan(&id))
					require.NoError(t, mediarefs.Add(ctx, db, mediarefs.Ref{UploadID: uploadID, Kind: mediarefs.Message, MessageID: id, ChatID: chat}))
					return id
				}
				switch tt.kind {
				case mediarefs.Message:
					messageID := attachMessage(chatID)
					if tt.deleted {
						_, err = db.Exec(`UPDATE messages.messages SET deleted_at = NOW() WHERE id = $1`, messageID)
						require.NoError(t, err)
					}
					if tt.left {
						_, err = db.Exec(`DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, tt.viewer)
						require.NoError(t, err)
					}
					if tt.secondChat {
						_, err = db.Exec(`DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, member)
						require.NoError(t, err)
						var second string
						require.NoError(t, db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'second', $1) RETURNING id::text`, owner).Scan(&second))
						_, err = db.Exec(`INSERT INTO chats.members (chat_id, user_id) VALUES ($1, $2)`, second, member)
						require.NoError(t, err)
						attachMessage(second)
					}
				case mediarefs.Avatar:
					require.NoError(t, mediarefs.ReplaceOwner(ctx, db, tt.kind, owner, uploadID))
				case mediarefs.ChatAvatar:
					require.NoError(t, mediarefs.ReplaceOwner(ctx, db, tt.kind, chatID, uploadID))
					if tt.left {
						_, err = db.Exec(`DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`, chatID, tt.viewer)
						require.NoError(t, err)
					}
				case mediarefs.Gif:
					var gifID string
					require.NoError(t, db.QueryRow(`INSERT INTO media.gifs (user_id, url) VALUES ($1, $2) RETURNING id::text`, owner, mediarefs.URLPrefix+uploadID).Scan(&gifID))
					require.NoError(t, mediarefs.Add(ctx, db, mediarefs.Ref{Kind: tt.kind, UploadID: uploadID, GifID: gifID}))
				}
				if tt.missing {
					uploadID = "dddddddd-4444-4444-8444-444444444444"
				}
				if tt.invalid {
					uploadID = "not-a-uuid"
				}
				store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
					return objectResponse(200, "data"), nil
				}}
				h := NewHandler(NewService(db, store, "uploads", 1024))
				mux := http.NewServeMux()
				mux.Handle("/api/v2/media/", authctx.Middleware(accessTestAuth{}, accessTestAuth{})(http.HandlerFunc(h.Serve)))
				r := httptest.NewRequest(method, mediarefs.URLPrefix+uploadID, nil)
				if tt.viewer != "" {
					r.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: tt.viewer})
				}
				w := httptest.NewRecorder()
				mux.ServeHTTP(w, r)
				require.Equal(t, tt.status, w.Code, w.Body.String())
				if tt.status == 200 {
					require.Equal(t, 1, store.getCalls)
					require.Equal(t, "private, no-cache", w.Header().Get("Cache-Control"))
					require.Equal(t, "Authorization, Cookie", w.Header().Get("Vary"))
					if method == http.MethodHead {
						require.Empty(t, w.Body.String())
					}
				} else {
					require.Zero(t, store.getCalls)
					require.Equal(t, "application/json", w.Header().Get("Content-Type"))
					for _, key := range []string{"Content-Length", "Content-Disposition", "Content-Range", "ETag", "Last-Modified"} {
						require.Empty(t, w.Header().Get(key), key)
					}
					require.NotContains(t, w.Body.String(), "secret.png")
					if tt.status == 403 {
						require.Contains(t, w.Body.String(), `"code":"forbidden"`)
					}
				}
			})
		}
	}
	require.ErrorIs(t, NewService(db, nil, "", 1024).CanDownload(ctx, owner, "bad-uuid"), ErrNotFound)
}

func TestManagedCatalogDownloadAccess(t *testing.T) {
	t.Setenv("CRANE_ENV", "development")
	db := dbtest.Postgres(t)
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	const other = "bbbbbbbb-2222-4222-8222-222222222222"
	dbtest.User(t, db, owner, "catalog_owner")
	dbtest.User(t, db, other, "catalog_other")
	var packID, stickerID, legacyID string
	require.NoError(t, db.QueryRow(`INSERT INTO media.sticker_packs (user_id, name, icon_bucket, icon_object_key) VALUES ($1, 'pack', 'uploads', 'icon') RETURNING id::text`, owner).Scan(&packID))
	require.NoError(t, db.QueryRow(`INSERT INTO media.stickers (pack_id, image_url, bucket, object_key) VALUES ($1, '', 'uploads', 'sticker') RETURNING id::text`, packID).Scan(&stickerID))
	require.NoError(t, db.QueryRow(`INSERT INTO media.stickers (pack_id, image_url) VALUES ($1, 'https://legacy.invalid/image') RETURNING id::text`, packID).Scan(&legacyID))
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		object := objectResponse(http.StatusOK, "data")
		object.ContentType = "image/png"
		return object, nil
	}}
	h := NewHandler(NewService(db, store, "uploads", 1024))
	handler := authctx.Middleware(accessTestAuth{}, accessTestAuth{})(http.HandlerFunc(h.Serve))
	check := func(id, viewer string, want int) {
		t.Helper()
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			for _, headerAuth := range []bool{false, true} {
				r := httptest.NewRequest(method, mediarefs.URLPrefix+id, nil)
				if viewer != "" {
					if headerAuth {
						r.Header.Set("Authorization", "Bearer "+viewer)
					} else {
						r.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: viewer})
					}
				}
				before := store.getCalls
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				expected := want
				if headerAuth && viewer != "" {
					expected = 401
				} // #705 accepts only session cookies.
				require.Equal(t, expected, w.Code, "%s %s: %s", method, id, w.Body.String())
				if expected == 200 {
					require.Equal(t, "private, no-cache", w.Header().Get("Cache-Control"))
					require.Equal(t, before+1, store.getCalls)
					if method == http.MethodHead {
						require.Empty(t, w.Body.String())
					}
				} else {
					require.Equal(t, before, store.getCalls)
				}
			}
		}
	}
	for _, id := range []string{packID, stickerID, legacyID} {
		check(id, "", 401)
	}
	for _, viewer := range []string{owner, other} {
		check(packID, viewer, 200)
		check(stickerID, viewer, 200)
		check(legacyID, viewer, 404)
	}
	_, err := db.Exec(`DELETE FROM media.stickers WHERE id = $1`, stickerID)
	require.NoError(t, err)
	check(stickerID, owner, 404)
	_, err = db.Exec(`DELETE FROM media.sticker_packs WHERE id = $1`, packID)
	require.NoError(t, err)
	check(packID, owner, 404)
	check(legacyID, other, 404)
}
