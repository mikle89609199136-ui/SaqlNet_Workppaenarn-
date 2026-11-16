//go:build integration

package user

import (
	"database/sql"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

// Полное удаление аккаунта (AC-2…AC-8). Фикстура заводит пользователя со
// следами во всех таблицах, которые затрагивает Service.DeleteAllData, и
// второй аккаунт, чьи данные удаление трогать не должно.
const (
	deleteAllTargetID   = "aaaaaaaa-1111-4111-8111-111111111111"
	deleteAllPeerID     = "bbbbbbbb-2222-4222-8222-222222222222"
	deleteAllBucket     = "crane-media"
	deleteAllToken      = "delete-all-access-token"
	deleteAllOtherToken = "delete-all-other-access-token"
	deleteAllStaleToken = "delete-all-stale-token"
)

// deleteAllObject — координаты объекта в хранилище.
type deleteAllObject struct {
	bucket string
	key    string
}

// deleteAllFixture — то, что seedDeleteAll вернула тесту для проверок.
type deleteAllFixture struct {
	ownedChat       string
	peerChat        string
	peerReply       string
	exclusiveFile   string
	sharedFile      string
	callRoom        string
	report          string
	exclusiveObject deleteAllObject
	sharedObject    deleteAllObject
	stickerObject   deleteAllObject
	packIconObject  deleteAllObject
}

// seedDeleteAll заводит пользователя со следами во всех таблицах, которые
// затрагивает DeleteAllData, и второго пользователя с его собственным чатом,
// сообщением, баном, звонком и жалобой.
func seedDeleteAll(t *testing.T, db *sql.DB) *deleteAllFixture {
	t.Helper()
	f := &deleteAllFixture{
		exclusiveObject: deleteAllObject{bucket: deleteAllBucket, key: "delete-all/exclusive"},
		sharedObject:    deleteAllObject{bucket: deleteAllBucket, key: "delete-all/shared"},
		stickerObject:   deleteAllObject{bucket: deleteAllBucket, key: "delete-all/sticker"},
		packIconObject:  deleteAllObject{bucket: deleteAllBucket, key: "delete-all/pack-icon"},
	}
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.Exec(query, args...)
		require.NoError(t, err, query)
	}
	returning := func(dest *string, query string, args ...any) {
		t.Helper()
		require.NoError(t, db.QueryRow(query, args...).Scan(dest), query)
	}

	dbtest.User(t, db, deleteAllTargetID, "delete_all_target")
	dbtest.User(t, db, deleteAllPeerID, "delete_all_peer")

	// Профиль, настройки, присутствие, исключения приватности, подписки.
	exec(`INSERT INTO users.profiles (user_id, first_name) VALUES ($1, 'Target')`, deleteAllTargetID)
	exec(`INSERT INTO users.settings (user_id) VALUES ($1)`, deleteAllTargetID)
	exec(`INSERT INTO users.presence (user_id, online) VALUES ($1, TRUE)`, deleteAllTargetID)
	exec(`INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow)
		VALUES ($1, $2, 'lastSeen', TRUE)`, deleteAllTargetID, deleteAllPeerID)
	exec(`INSERT INTO users.push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1, 'https://push.invalid/delete-all', 'p256dh-test', 'auth-test')`, deleteAllTargetID)
	// Блокировки в обе стороны: удаление снимает обе половины пары.
	exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2), ($2, $1)`,
		deleteAllTargetID, deleteAllPeerID)
	// Две сессии с хешами access-токенов: их проверяет AC-7 через DBTokenChecker.
	exec(`INSERT INTO auth.sessions (user_id, access_token_hash, expires_at) VALUES
		($1, $2, NOW() + INTERVAL '1 hour'),
		($1, $3, NOW() + INTERVAL '1 hour')`,
		deleteAllTargetID, authctx.TokenHash(deleteAllToken), authctx.TokenHash(deleteAllOtherToken))
	exec(`INSERT INTO auth.revoked_tokens (token_hash, user_id, expires_at)
		VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
		authctx.TokenHash(deleteAllStaleToken), deleteAllTargetID)

	// Свой чат пользователя и чужой чат, в котором он состоит.
	returning(&f.ownedChat, `INSERT INTO chats.chats (type, title, owner_id)
		VALUES ('group', 'Owned by target', $1) RETURNING id::text`, deleteAllTargetID)
	returning(&f.peerChat, `INSERT INTO chats.chats (type, title, owner_id)
		VALUES ('group', 'Peer group', $1) RETURNING id::text`, deleteAllPeerID)
	exec(`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, 'owner')`, f.ownedChat, deleteAllTargetID)
	exec(`INSERT INTO chats.members (chat_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
		f.peerChat, deleteAllPeerID, deleteAllTargetID)

	var ownedMessage, peerMessage string
	returning(&ownedMessage, `INSERT INTO messages.messages (chat_id, sender_id, content)
		VALUES ($1, $2, 'owned') RETURNING id::text`, f.ownedChat, deleteAllTargetID)
	returning(&peerMessage, `INSERT INTO messages.messages (chat_id, sender_id, content)
		VALUES ($1, $2, 'peer chat') RETURNING id::text`, f.peerChat, deleteAllTargetID)
	// Ответ второго пользователя на сообщение удаляемого: reply_to не должен
	// ни заблокировать удаление (23503), ни остаться висячим.
	returning(&f.peerReply, `INSERT INTO messages.messages (chat_id, sender_id, content, reply_to)
		VALUES ($1, $2, 'reply', $3) RETURNING id::text`, f.peerChat, deleteAllPeerID, peerMessage)

	// Upload удаляемого: эксклюзивный — в его чате, общий — в сообщении второго.
	returning(&f.exclusiveFile, `INSERT INTO media.uploads (uploader_id, bucket, object_key, filename)
		VALUES ($1, $2, $3, 'exclusive.bin') RETURNING id::text`,
		deleteAllTargetID, deleteAllBucket, f.exclusiveObject.key)
	returning(&f.sharedFile, `INSERT INTO media.uploads (uploader_id, bucket, object_key, filename)
		VALUES ($1, $2, $3, 'shared.bin') RETURNING id::text`,
		deleteAllTargetID, deleteAllBucket, f.sharedObject.key)
	exec(`INSERT INTO media.upload_refs (upload_id, kind, message_id, chat_id) VALUES ($1, 'message', $2, $3)`,
		f.exclusiveFile, ownedMessage, f.ownedChat)
	exec(`INSERT INTO media.upload_refs (upload_id, kind, message_id, chat_id) VALUES ($1, 'message', $2, $3)`,
		f.sharedFile, f.peerReply, f.peerChat)

	// Набор стикеров: каскад от users удаляет и объекты хранилища.
	var pack string
	returning(&pack, `INSERT INTO media.sticker_packs (user_id, name, icon_bucket, icon_object_key)
		VALUES ($1, 'delete-all pack', $2, $3) RETURNING id::text`,
		deleteAllTargetID, deleteAllBucket, f.packIconObject.key)
	exec(`INSERT INTO media.stickers (pack_id, image_url, bucket, object_key)
		VALUES ($1, 'https://cdn.invalid/sticker.webp', $2, $3)`, pack, deleteAllBucket, f.stickerObject.key)

	// MLS-строки — в чужом чате: каскад от chats их не удалит, только явный DELETE.
	exec(`INSERT INTO crypto.group_mls_commits (chat_id, epoch, sender_id, commit_bytes)
		VALUES ($1, 1, $2, 'commit')`, f.peerChat, deleteAllTargetID)
	exec(`INSERT INTO crypto.group_mls_welcome (chat_id, recipient_id, sender_id, epoch, welcome_bytes)
		VALUES ($1, $2, $3, 1, 'welcome')`, f.peerChat, deleteAllPeerID, deleteAllTargetID)
	exec(`INSERT INTO crypto.group_mls_proposals (chat_id, sender_id, proposal_type, proposal_bytes, epoch)
		VALUES ($1, $2, 'ADD', 'proposal', 1)`, f.peerChat, deleteAllTargetID)

	// Комната звонка, жалоба и бан остаются: обнуляется только автор.
	returning(&f.callRoom, `INSERT INTO calls.rooms (chat_id, initiator_id, type)
		VALUES ($1, $2, 'voice') RETURNING id::text`, f.peerChat, deleteAllTargetID)
	returning(&f.report, `INSERT INTO admin.reports
		(reporter_id, target_type, target_id, reason, status, resolution, resolved_at, resolved_by)
		VALUES ($1, 'user', $2, 'spam', 'resolved', 'ok', NOW(), $2) RETURNING id::text`,
		deleteAllPeerID, deleteAllTargetID)
	exec(`INSERT INTO chats.bans (chat_id, user_id, banned_by, reason) VALUES ($1, $2, $3, 'spam')`,
		f.peerChat, deleteAllPeerID, deleteAllTargetID)

	return f
}

// deleteAllRows — count(*) по запросу; запрос обязан вернуть одну строку.
func deleteAllRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRow(query, args...).Scan(&count), query)
	return count
}

func deleteAllZero(t *testing.T, db *sql.DB, name, query string, args ...any) {
	t.Helper()
	require.Zero(t, deleteAllRows(t, db, query, args...), name)
}

func deleteAllOne(t *testing.T, db *sql.DB, name, query string, args ...any) {
	t.Helper()
	require.Equal(t, 1, deleteAllRows(t, db, query, args...), name)
}

// TestDeleteAllDataRemovesAccountScopedRows — AC-2: все строки, привязанные к
// удаляемому аккаунту, исчезают, второй пользователь не затронут.
func TestDeleteAllDataRemovesAccountScopedRows(t *testing.T) {
	db := dbtest.Postgres(t)
	seedDeleteAll(t, db)
	require.NoError(t, NewService(db).DeleteAllData(t.Context(), deleteAllTargetID))

	deleteAllZero(t, db, "auth.users", `SELECT count(*) FROM auth.users WHERE id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "auth.sessions", `SELECT count(*) FROM auth.sessions WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "users.profiles", `SELECT count(*) FROM users.profiles WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "users.settings", `SELECT count(*) FROM users.settings WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "users.presence", `SELECT count(*) FROM users.presence WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "users.privacy_exceptions", `SELECT count(*) FROM users.privacy_exceptions WHERE owner_id = $1 OR user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "users.push_subscriptions", `SELECT count(*) FROM users.push_subscriptions WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "auth.revoked_tokens", `SELECT count(*) FROM auth.revoked_tokens WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "chats.chats", `SELECT count(*) FROM chats.chats WHERE owner_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "chats.members", `SELECT count(*) FROM chats.members WHERE user_id = $1`, deleteAllTargetID)
	deleteAllZero(t, db, "messages.messages", `SELECT count(*) FROM messages.messages WHERE sender_id = $1`, deleteAllTargetID)
	// Здесь в фикстуре только строки удаляемого: проверяем таблицы целиком,
	// включая обе стороны блокировок.
	deleteAllZero(t, db, "users.blocked_users", `SELECT count(*) FROM users.blocked_users`)
	deleteAllZero(t, db, "crypto.group_mls_commits", `SELECT count(*) FROM crypto.group_mls_commits`)
	deleteAllZero(t, db, "crypto.group_mls_welcome", `SELECT count(*) FROM crypto.group_mls_welcome`)
	deleteAllZero(t, db, "crypto.group_mls_proposals", `SELECT count(*) FROM crypto.group_mls_proposals`)
	deleteAllOne(t, db, "второй пользователь цел", `SELECT count(*) FROM auth.users WHERE id = $1`, deleteAllPeerID)
}

// TestDeleteAllDataKeepsPeerConversation — AC-3: сообщение второго пользователя
// в чужом чате остаётся, reply_to снят, свой чат удалён.
func TestDeleteAllDataKeepsPeerConversation(t *testing.T) {
	db := dbtest.Postgres(t)
	f := seedDeleteAll(t, db)
	require.NoError(t, NewService(db).DeleteAllData(t.Context(), deleteAllTargetID))

	var replyTo sql.NullString
	require.NoError(t, db.QueryRow(`SELECT reply_to::text FROM messages.messages WHERE id = $1`, f.peerReply).Scan(&replyTo),
		"сообщение второго пользователя должно остаться")
	require.False(t, replyTo.Valid, "ссылка на удалённое сообщение снята, а не осталась висячей")
	deleteAllOne(t, db, "чужой чат цел", `SELECT count(*) FROM chats.chats WHERE id = $1`, f.peerChat)
	deleteAllZero(t, db, "свой чат удалён", `SELECT count(*) FROM chats.chats WHERE id = $1`, f.ownedChat)
	deleteAllZero(t, db, "сообщения своего чата", `SELECT count(*) FROM messages.messages WHERE chat_id = $1`, f.ownedChat)
}

// TestDeleteAllDataDetachesActorAndKeepsAuditRows — AC-4: бан, комната звонка и
// жалоба остаются, автор обнулён.
func TestDeleteAllDataDetachesActorAndKeepsAuditRows(t *testing.T) {
	db := dbtest.Postgres(t)
	f := seedDeleteAll(t, db)
	require.NoError(t, NewService(db).DeleteAllData(t.Context(), deleteAllTargetID))

	var bannedBy sql.NullString
	require.NoError(t, db.QueryRow(`SELECT banned_by::text FROM chats.bans WHERE chat_id = $1 AND user_id = $2`,
		f.peerChat, deleteAllPeerID).Scan(&bannedBy))
	require.False(t, bannedBy.Valid, "бан остаётся, автор бана обнулён")

	var initiator sql.NullString
	require.NoError(t, db.QueryRow(`SELECT initiator_id::text FROM calls.rooms WHERE id = $1`, f.callRoom).Scan(&initiator))
	require.False(t, initiator.Valid, "комната звонка не удалена, инициатор обнулён")

	var resolvedBy sql.NullString
	var status string
	require.NoError(t, db.QueryRow(`SELECT resolved_by::text, status FROM admin.reports WHERE id = $1`, f.report).
		Scan(&resolvedBy, &status))
	require.False(t, resolvedBy.Valid, "жалоба остаётся в аудите")
	require.Equal(t, "resolved", status)
}

// TestDeleteAllDataKeepsUploadsWithoutUploader — AC-5: загрузки остаются с
// обнулённым uploader_id, строк с uploader_id удаляемого не остаётся.
func TestDeleteAllDataKeepsUploadsWithoutUploader(t *testing.T) {
	db := dbtest.Postgres(t)
	f := seedDeleteAll(t, db)
	require.NoError(t, NewService(db).DeleteAllData(t.Context(), deleteAllTargetID))

	for _, upload := range []struct {
		name string
		id   string
	}{
		{"эксклюзивный upload", f.exclusiveFile},
		{"общий upload", f.sharedFile},
	} {
		var uploader sql.NullString
		require.NoError(t, db.QueryRow(`SELECT uploader_id::text FROM media.uploads WHERE id = $1`, upload.id).
			Scan(&uploader), upload.name)
		require.False(t, uploader.Valid, upload.name)
	}
	deleteAllZero(t, db, "uploads удаляемого", `SELECT count(*) FROM media.uploads WHERE uploader_id = $1`, deleteAllTargetID)
}

// TestDeleteAllDataQueuesMediaCleanup — AC-6: объекты удалённых uploads и
// стикеров поставлены в очередь очистки, worker не запускался.
func TestDeleteAllDataQueuesMediaCleanup(t *testing.T) {
	db := dbtest.Postgres(t)
	f := seedDeleteAll(t, db)
	require.NoError(t, NewService(db).DeleteAllData(t.Context(), deleteAllTargetID))

	deleteAllZero(t, db, "worker очистки не запускался", `SELECT count(*) FROM media.object_deletions`)
	for _, object := range []struct {
		name string
		ref  deleteAllObject
	}{
		{"upload без владельца", f.exclusiveObject},
		{"общий upload", f.sharedObject},
		{"стикер", f.stickerObject},
		{"иконка набора", f.packIconObject},
	} {
		require.NotZero(t, deleteAllRows(t, db,
			`SELECT count(*) FROM media.object_cleanup_jobs WHERE bucket = $1 AND object_key = $2 AND completed_at IS NULL`,
			object.ref.bucket, object.ref.key), object.name)
	}
}

// TestDeleteAllDataRevokesIssuedTokens — AC-7: токены удалённого аккаунта
// отклоняет тот же DBTokenChecker, что стоит в middleware authctx.
func TestDeleteAllDataRevokesIssuedTokens(t *testing.T) {
	db := dbtest.Postgres(t)
	seedDeleteAll(t, db)
	ctx := t.Context()
	checker := authctx.NewDBTokenChecker(db)
	claims := cryptoclient.TokenClaims{Subject: deleteAllTargetID, TokenGeneration: 0}
	revoked, err := checker.IsTokenRevoked(ctx, deleteAllToken, claims)
	require.NoError(t, err)
	require.False(t, revoked, "до удаления токен действителен")

	require.NoError(t, NewService(db).DeleteAllData(ctx, deleteAllTargetID))

	revoked, err = checker.IsTokenRevoked(ctx, deleteAllToken, claims)
	require.NoError(t, err)
	require.True(t, revoked, "после удаления аккаунта токен недействителен")
}

// TestDeleteAllDataIsIdempotent — AC-8: повторное удаление — no-op без новых
// задач очистки.
func TestDeleteAllDataIsIdempotent(t *testing.T) {
	db := dbtest.Postgres(t)
	dbtest.User(t, db, deleteAllTargetID, "delete_all_idempotent")
	_, err := db.Exec(`INSERT INTO media.uploads (uploader_id, bucket, object_key)
		VALUES ($1, $2, 'delete-all/idempotent')`, deleteAllTargetID, deleteAllBucket)
	require.NoError(t, err)
	svc := NewService(db)
	require.NoError(t, svc.DeleteAllData(t.Context(), deleteAllTargetID))
	jobs := deleteAllRows(t, db, `SELECT count(*) FROM media.object_cleanup_jobs`)
	require.NotZero(t, jobs, "фикстура должна была поставить задачу очистки")

	require.NoError(t, svc.DeleteAllData(t.Context(), deleteAllTargetID), "повторный вызов — no-op")
	require.Equal(t, jobs, deleteAllRows(t, db, `SELECT count(*) FROM media.object_cleanup_jobs`))
	require.Zero(t, deleteAllRows(t, db, `SELECT count(*) FROM auth.users WHERE id = $1`, deleteAllTargetID))
}
