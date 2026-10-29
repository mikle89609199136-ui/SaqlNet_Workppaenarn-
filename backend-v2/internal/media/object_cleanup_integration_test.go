//go:build integration

package media

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/mediarefs"
	"github.com/stretchr/testify/require"
)

func TestUploadCleanupLifecycle(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	const keeper = "bbbbbbbb-2222-4222-8222-222222222222"
	dbtest.User(t, db, owner, "cleanup_owner")
	dbtest.User(t, db, keeper, "cleanup_keeper")
	ctx := t.Context()
	store := &cleanupTestStore{deleteErr: map[string]error{}}
	worker := NewCleanupWorker(db, store)
	upload := func(key string) string {
		var id string
		require.NoError(t, db.QueryRow(`INSERT INTO media.uploads(uploader_id,bucket,object_key) VALUES($1,'bucket',$2) RETURNING id::text`, owner, key).Scan(&id))
		return id
	}
	attach := func(id string) string {
		var chat, msg string
		require.NoError(t, db.QueryRow(`INSERT INTO chats.chats(type,owner_id) VALUES('group',$1) RETURNING id::text`, keeper).Scan(&chat))
		_, err := db.Exec(`INSERT INTO chats.members(chat_id,user_id) VALUES($1,$2)`, chat, keeper)
		require.NoError(t, err)
		require.NoError(t, db.QueryRow(`INSERT INTO messages.messages(chat_id,sender_id) VALUES($1,$2) RETURNING id::text`, chat, keeper).Scan(&msg))
		require.NoError(t, mediarefs.Add(ctx, db, mediarefs.Ref{UploadID: id, Kind: mediarefs.Message, MessageID: msg, ChatID: chat}))
		return msg
	}
	due := func() {
		_, err := db.Exec(`UPDATE media.object_cleanup_jobs SET next_attempt_at=NOW()`)
		require.NoError(t, err)
	}
	process := func(wantDelete bool) {
		before := store.deleteCount()
		processed, err := worker.ProcessNext(ctx)
		require.NoError(t, err)
		require.True(t, processed)
		require.Equal(t, wantDelete, store.deleteCount() > before)
	}
	// Grace period is checked again by the worker even if a job is forced due.
	fresh := upload("fresh")
	due()
	process(false)
	_, err := db.Exec(`UPDATE media.uploads SET created_at=NOW()-INTERVAL '8 days' WHERE id=$1`, fresh)
	require.NoError(t, err)
	due()
	process(true)
	// Forwarded/shared media survives the first removed message.
	shared := upload("shared")
	first, second := attach(shared), attach(shared)
	_, err = db.Exec(`UPDATE messages.messages SET deleted_at=NOW() WHERE id=$1`, first)
	require.NoError(t, err)
	process(false)
	_, err = db.Exec(`UPDATE messages.messages SET deleted_at=NOW() WHERE id=$1`, second)
	require.NoError(t, err)
	process(true)
	// Removing an uploader retains shared media coordinates and its live reference.
	retained := upload("retained")
	message := attach(retained)
	orphan := upload("uploader-orphan")
	_, err = db.Exec(`DELETE FROM auth.users WHERE id=$1`, owner)
	require.NoError(t, err)
	var uploader sql.NullString
	require.NoError(t, db.QueryRow(`SELECT uploader_id::text FROM media.uploads WHERE id=$1`, retained).Scan(&uploader))
	require.False(t, uploader.Valid)
	require.NoError(t, NewService(db, store, "bucket", 1024).CanDownload(ctx, keeper, retained))
	// Both jobs are due, and only the unreferenced object can be removed.
	process(false)
	process(true)
	var count int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM media.uploads WHERE id=$1`, orphan).Scan(&count))
	require.Zero(t, count)
	_, err = db.Exec(`DELETE FROM messages.messages WHERE id=$1`, message)
	require.NoError(t, err)
	process(true)
}

func TestCleanupRetryAndAttachmentFence(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	dbtest.User(t, db, owner, "cleanup_retry")
	var id string
	require.NoError(t, db.QueryRow(`INSERT INTO media.uploads(uploader_id,bucket,object_key,created_at) VALUES($1,'bucket','retry',NOW()-INTERVAL '8 days') RETURNING id::text`, owner).Scan(&id))
	failure := errors.New("storage unavailable")
	store := &cleanupTestStore{deleteErr: map[string]error{"bucket/retry": failure}}
	worker := NewCleanupWorker(db, store)
	processed, err := worker.ProcessNext(t.Context())
	require.True(t, processed)
	require.ErrorIs(t, err, failure)
	// Once deletion has started, an attachment must fail even during a retry.
	err = mediarefs.Add(t.Context(), db, mediarefs.Ref{UploadID: id, Kind: mediarefs.Avatar, UserID: owner})
	require.Error(t, err)
	var attempts int
	var next time.Time
	require.NoError(t, db.QueryRow(`SELECT attempts,next_attempt_at FROM media.object_cleanup_jobs WHERE object_key='retry'`).Scan(&attempts, &next))
	require.Equal(t, 1, attempts)
	require.True(t, next.After(time.Now()))
	store.deleteErr["bucket/retry"] = nil
	_, err = db.Exec(`UPDATE media.object_cleanup_jobs SET next_attempt_at=NOW()`)
	require.NoError(t, err)
	processed, err = worker.ProcessNext(context.Background())
	require.True(t, processed)
	require.NoError(t, err)
}

func TestCleanupWaitsForConcurrentAttachment(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	dbtest.User(t, db, owner, "cleanup_race")
	var id string
	require.NoError(t, db.QueryRow(`INSERT INTO media.uploads(uploader_id,bucket,object_key,created_at) VALUES($1,'bucket','race',NOW()-INTERVAL '8 days') RETURNING id::text`, owner).Scan(&id))
	tx, err := db.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	defer tx.Rollback() // Освобождаем блокировку и при провале assertion.
	require.NoError(t, mediarefs.Add(t.Context(), tx, mediarefs.Ref{UploadID: id, Kind: mediarefs.Avatar, UserID: owner}))
	store := &cleanupTestStore{deleteErr: map[string]error{}}
	done := make(chan error, 1)
	go func() { _, err := NewCleanupWorker(db, store).ProcessNext(t.Context()); done <- err }()
	select {
	case err := <-done:
		t.Fatalf("cleanup не дождался прикрепления: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, tx.Commit())
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup не завершился после commit")
	}
	require.Zero(t, store.deleteCount())
}

func TestCleanupProtectsAvatarGifAndCatalog(t *testing.T) {
	db := dbtest.Postgres(t)
	const owner = "aaaaaaaa-1111-4111-8111-111111111111"
	dbtest.User(t, db, owner, "cleanup_catalog")
	for _, kind := range []string{"avatar", "chat_avatar", "gif", "catalog"} {
		t.Run(kind, func(t *testing.T) {
			var id string
			require.NoError(t, db.QueryRow(`INSERT INTO media.uploads(uploader_id,bucket,object_key,content_type,created_at) VALUES($1,'bucket',$2,'image/gif',NOW()-INTERVAL '8 days') RETURNING id::text`, owner, kind).Scan(&id))
			switch kind {
			case "avatar":
				require.NoError(t, mediarefs.Add(t.Context(), db, mediarefs.Ref{UploadID: id, Kind: mediarefs.Avatar, UserID: owner}))
			case "chat_avatar":
				var chat string
				require.NoError(t, db.QueryRow(`INSERT INTO chats.chats(type,owner_id) VALUES('group',$1) RETURNING id::text`, owner).Scan(&chat))
				require.NoError(t, mediarefs.Add(t.Context(), db, mediarefs.Ref{UploadID: id, Kind: mediarefs.ChatAvatar, ChatID: chat}))
			case "gif":
				var gif string
				require.NoError(t, db.QueryRow(`INSERT INTO media.gifs(user_id,url) VALUES($1,$2) RETURNING id::text`, owner, mediarefs.URLPrefix+id).Scan(&gif))
				require.NoError(t, mediarefs.Add(t.Context(), db, mediarefs.Ref{UploadID: id, Kind: mediarefs.Gif, GifID: gif}))
			case "catalog":
				var pack string
				require.NoError(t, db.QueryRow(`INSERT INTO media.sticker_packs(user_id,name,icon_bucket,icon_object_key) VALUES($1,'cleanup','bucket',$2) RETURNING id::text`, owner, kind).Scan(&pack))
			}
			store := &cleanupTestStore{deleteErr: map[string]error{}}
			processed, err := NewCleanupWorker(db, store).ProcessNext(t.Context())
			require.NoError(t, err)
			require.True(t, processed)
			require.Zero(t, store.deleteCount())
			if kind == "catalog" {
				_, err = db.Exec(`DELETE FROM media.sticker_packs WHERE icon_bucket='bucket' AND icon_object_key=$1`, kind)
			} else {
				_, err = db.Exec(`DELETE FROM media.upload_refs WHERE upload_id=$1`, id)
			}
			require.NoError(t, err)
			processed, err = NewCleanupWorker(db, store).ProcessNext(t.Context())
			require.NoError(t, err)
			require.True(t, processed)
			require.Equal(t, 1, store.deleteCount())
		})
	}
}
