package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"craneapp/backend-v2/internal/media"
	_ "github.com/lib/pq"
)

func main() {
	apply := flag.Bool("apply", false, "commit migrated records; without this flag the transaction is rolled back")
	domain := flag.String("domain", "all", "domain to migrate: auth, users, chats, messages, media, all")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	timeout := 5 * time.Minute
	if *domain == "media" || *domain == "all" {
		timeout = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		log.Fatal(err)
	}
	defer tx.Rollback()

	var legacySchemaExists bool
	if err := tx.QueryRowContext(ctx, `SELECT to_regclass('public.users') IS NOT NULL`).Scan(&legacySchemaExists); err != nil {
		log.Fatalf("check legacy schema: %v", err)
	}
	if !legacySchemaExists {
		if !*apply {
			fmt.Println("legacy schema not found; dry-run has nothing to migrate")
			return
		}
		if err := tx.Commit(); err != nil {
			log.Fatal(err)
		}
		fmt.Println("legacy schema not found; nothing to migrate")
		return
	}

	if *domain == "auth" || *domain == "all" {
		migrateAuth(ctx, tx)
	}
	if *domain == "users" || *domain == "all" {
		migrateUsers(ctx, tx)
	}
	if *domain == "chats" || *domain == "all" {
		migrateChats(ctx, tx)
	}
	if *domain == "messages" || *domain == "all" {
		migrateMessages(ctx, tx)
	}
	if *domain == "media" || *domain == "all" {
		migrateMedia(ctx, tx, *apply)
	}
	if *domain != "auth" && *domain != "users" && *domain != "chats" && *domain != "messages" && *domain != "media" && *domain != "all" {
		log.Fatalf("unknown domain %q", *domain)
	}

	if !*apply {
		fmt.Println("dry-run complete; rolling back (pass --apply to commit)")
		return
	}
	if err := tx.Commit(); err != nil {
		log.Fatal(err)
	}
	fmt.Println("legacy migration committed")
}

func migrateAuth(ctx context.Context, tx *sql.Tx) {
	var legacyCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM public.users WHERE username IS NOT NULL AND password_hash IS NOT NULL`).Scan(&legacyCount); err != nil {
		log.Fatalf("count legacy auth users: %v", err)
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO auth.users (id, username, password_hash, first_name, last_name, created_at, updated_at, disabled_at)
		SELECT
			id,
			LOWER(username),
			password_hash,
			COALESCE(NULLIF(first_name, ''), username),
			COALESCE(last_name, ''),
			COALESCE(created_at, NOW()),
			COALESCE(updated_at, NOW()),
			CASE WHEN COALESCE(is_blocked, FALSE) THEN NOW() ELSE NULL END
		FROM public.users
		WHERE username IS NOT NULL AND password_hash IS NOT NULL
		ON CONFLICT (id) DO UPDATE SET
			username = EXCLUDED.username,
			password_hash = EXCLUDED.password_hash,
			first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			updated_at = EXCLUDED.updated_at,
			disabled_at = EXCLUDED.disabled_at
	`)
	if err != nil {
		log.Fatalf("migrate auth users: %v", err)
	}
	affected, _ := result.RowsAffected()

	result, err = tx.ExecContext(ctx, `
		INSERT INTO auth.sessions (id, user_id, refresh_token_hash, expires_at, created_at)
		SELECT id, user_id, refresh_token, expires_at, created_at
		FROM public.sessions
		WHERE user_id IN (SELECT id FROM auth.users)
		ON CONFLICT (id) DO UPDATE SET
			refresh_token_hash = EXCLUDED.refresh_token_hash,
			expires_at = EXCLUDED.expires_at
	`)
	if err != nil {
		log.Fatalf("migrate auth sessions: %v", err)
	}
	sessionsAffected, _ := result.RowsAffected()

	var migratedCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM auth.users`).Scan(&migratedCount); err != nil {
		log.Fatalf("count migrated auth users: %v", err)
	}

	fmt.Printf("auth: legacy users=%d migrated users=%d affected=%d sessions_affected=%d\n", legacyCount, migratedCount, affected, sessionsAffected)
	if migratedCount < legacyCount {
		log.Fatalf("auth integrity check failed: migrated count is lower than legacy count")
	}
}

func migrateUsers(ctx context.Context, tx *sql.Tx) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO users.profiles (user_id, first_name, last_name, bio, avatar_url, badges, is_premium, created_at, updated_at)
		SELECT
			u.id,
			COALESCE(NULLIF(u.first_name, ''), u.username),
			COALESCE(u.last_name, ''),
			COALESCE(u.bio, ''),
			COALESCE(u.avatar_url, ''),
			CASE WHEN u.is_verified THEN '{verified}' ELSE '{}' END::text[],
			COALESCE(u.is_premium, FALSE),
			COALESCE(u.created_at, NOW()),
			COALESCE(u.updated_at, NOW())
		FROM public.users u
		JOIN auth.users au ON au.id = u.id
		ON CONFLICT (user_id) DO UPDATE SET
			first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			bio = EXCLUDED.bio,
			avatar_url = EXCLUDED.avatar_url,
			badges = EXCLUDED.badges,
			is_premium = EXCLUDED.is_premium,
			updated_at = EXCLUDED.updated_at
	`)
	if err != nil {
		log.Fatalf("migrate user profiles: %v", err)
	}
	profilesAffected, _ := result.RowsAffected()

	result, err = tx.ExecContext(ctx, `
		INSERT INTO users.settings
			(user_id, settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings, folders, created_at, updated_at)
		SELECT
			us.user_id,
			COALESCE(us.settings, '{}'::jsonb),
			COALESCE(us.privacy_settings, '{}'::jsonb),
			COALESCE(us.notification_settings, '{}'::jsonb),
			COALESCE(us.sound_settings, '{}'::jsonb),
			COALESCE(us.storage_settings, '{}'::jsonb),
			COALESCE(us.advanced_settings, '{}'::jsonb),
			COALESCE(us.folders, '[]'::jsonb),
			COALESCE(us.created_at, NOW()),
			COALESCE(us.updated_at, NOW())
		FROM public.user_settings us
		JOIN auth.users au ON au.id = us.user_id
		ON CONFLICT (user_id) DO UPDATE SET
			settings = EXCLUDED.settings,
			privacy_settings = EXCLUDED.privacy_settings,
			notification_settings = EXCLUDED.notification_settings,
			sound_settings = EXCLUDED.sound_settings,
			storage_settings = EXCLUDED.storage_settings,
			advanced_settings = EXCLUDED.advanced_settings,
			folders = EXCLUDED.folders,
			updated_at = EXCLUDED.updated_at
	`)
	if err != nil {
		log.Fatalf("migrate user settings: %v", err)
	}
	settingsAffected, _ := result.RowsAffected()

	result, err = tx.ExecContext(ctx, `
		INSERT INTO users.blocked_users (user_id, blocked_user_id, blocked_at)
		SELECT b.user_id, b.blocked_user_id, COALESCE(b.blocked_at, NOW())
		FROM public.blocked_users b
		JOIN auth.users au ON au.id = b.user_id
		JOIN auth.users bu ON bu.id = b.blocked_user_id
		WHERE b.user_id <> b.blocked_user_id
		ON CONFLICT (user_id, blocked_user_id) DO UPDATE SET blocked_at = EXCLUDED.blocked_at
	`)
	if err != nil {
		log.Fatalf("migrate blocked users: %v", err)
	}
	blockedAffected, _ := result.RowsAffected()

	var profiles int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users.profiles`).Scan(&profiles); err != nil {
		log.Fatalf("count user profiles: %v", err)
	}
	fmt.Printf("users: profiles=%d affected_profiles=%d affected_settings=%d affected_blocked=%d\n", profiles, profilesAffected, settingsAffected, blockedAffected)

	// Rebind public.user_sessions foreign key to auth.users
	if _, err := tx.ExecContext(ctx, `DELETE FROM public.user_sessions WHERE user_id NOT IN (SELECT id FROM auth.users)`); err != nil {
		log.Fatalf("delete orphaned user_sessions: %v", err)
	}

	// Drop old foreign key. We find it dynamically in case it has a different name.
	if _, err := tx.ExecContext(ctx, `
		DO $$
		DECLARE fk_name text;
		BEGIN
			SELECT constraint_name INTO fk_name
			FROM information_schema.key_column_usage
			WHERE table_schema = 'public' AND table_name = 'user_sessions' AND column_name = 'user_id'
			AND constraint_name IN (
				SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY'
			) LIMIT 1;
			
			IF fk_name IS NOT NULL THEN
				EXECUTE 'ALTER TABLE public.user_sessions DROP CONSTRAINT ' || fk_name;
			END IF;
		END $$;
	`); err != nil {
		log.Fatalf("drop old foreign key for user_sessions: %v", err)
	}

	if _, err := tx.ExecContext(ctx, `
		ALTER TABLE public.user_sessions 
		ADD CONSTRAINT user_sessions_user_id_fkey 
		FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
	`); err != nil {
		log.Fatalf("add new foreign key for user_sessions: %v", err)
	}
	fmt.Println("users: successfully rebound public.user_sessions foreign key to auth.users")
}

func migrateChats(ctx context.Context, tx *sql.Tx) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO chats.chats (id, type, title, description, avatar_url, owner_id, created_at, updated_at)
		SELECT
			c.id,
			c.type,
			COALESCE(NULLIF(c.title, ''), NULLIF(c.name, ''), c.type),
			COALESCE(c.description, ''),
			COALESCE(c.avatar_url, c.avatar, ''),
			COALESCE(c.owner_id, cm_owner.user_id),
			COALESCE(c.created_at, NOW()),
			COALESCE(c.updated_at, NOW())
		FROM public.chats c
		LEFT JOIN LATERAL (
			SELECT user_id FROM public.chat_members WHERE chat_id = c.id ORDER BY joined_at ASC LIMIT 1
		) cm_owner ON TRUE
		WHERE COALESCE(c.owner_id, cm_owner.user_id) IN (SELECT id FROM auth.users)
		ON CONFLICT (id) DO UPDATE SET
			type = EXCLUDED.type,
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			avatar_url = EXCLUDED.avatar_url,
			owner_id = EXCLUDED.owner_id,
			updated_at = EXCLUDED.updated_at
	`)
	if err != nil {
		log.Fatalf("migrate chats: %v", err)
	}
	chatsAffected, _ := result.RowsAffected()

	result, err = tx.ExecContext(ctx, `
		INSERT INTO chats.members (chat_id, user_id, role, permissions, muted_until, joined_at)
		SELECT cm.chat_id, cm.user_id, cm.role, COALESCE(cm.permissions, '{}'::jsonb), cm.muted_until, COALESCE(cm.joined_at, NOW())
		FROM public.chat_members cm
		JOIN chats.chats c ON c.id = cm.chat_id
		JOIN auth.users au ON au.id = cm.user_id
		ON CONFLICT (chat_id, user_id) DO UPDATE SET
			role = EXCLUDED.role,
			permissions = EXCLUDED.permissions,
			muted_until = EXCLUDED.muted_until
	`)
	if err != nil {
		log.Fatalf("migrate chat members: %v", err)
	}
	membersAffected, _ := result.RowsAffected()

	result, err = tx.ExecContext(ctx, `
		INSERT INTO chats.user_chat_settings (user_id, chat_id, is_pinned, pinned_at, is_archived, archived_at, last_read_at)
		SELECT ucs.user_id, ucs.chat_id, COALESCE(ucs.is_pinned, FALSE), ucs.pinned_at,
		       COALESCE(ucs.is_archived, FALSE), ucs.archived_at, ucs.last_read_at
		FROM public.user_chat_settings ucs
		JOIN chats.chats c ON c.id = ucs.chat_id
		JOIN auth.users au ON au.id = ucs.user_id
		ON CONFLICT (user_id, chat_id) DO UPDATE SET
			is_pinned = EXCLUDED.is_pinned,
			pinned_at = EXCLUDED.pinned_at,
			is_archived = EXCLUDED.is_archived,
			archived_at = EXCLUDED.archived_at,
			last_read_at = EXCLUDED.last_read_at
	`)
	if err != nil {
		log.Fatalf("migrate user chat settings: %v", err)
	}
	settingsAffected, _ := result.RowsAffected()

	result, err = tx.ExecContext(ctx, `
		INSERT INTO chats.bans (chat_id, user_id, banned_by, reason, banned_until, created_at)
		SELECT cb.chat_id, cb.user_id, cb.banned_by, COALESCE(cb.reason, ''), cb.banned_until, COALESCE(cb.created_at, NOW())
		FROM public.chat_bans cb
		JOIN chats.chats c ON c.id = cb.chat_id
		JOIN auth.users au ON au.id = cb.user_id
		LEFT JOIN auth.users bu ON bu.id = cb.banned_by
		ON CONFLICT (chat_id, user_id) DO UPDATE SET
			banned_by = EXCLUDED.banned_by,
			reason = EXCLUDED.reason,
			banned_until = EXCLUDED.banned_until
	`)
	if err != nil {
		log.Fatalf("migrate chat bans: %v", err)
	}
	bansAffected, _ := result.RowsAffected()

	var chatsCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM chats.chats`).Scan(&chatsCount); err != nil {
		log.Fatalf("count chats: %v", err)
	}
	fmt.Printf("chats: chats=%d affected_chats=%d affected_members=%d affected_settings=%d affected_bans=%d\n", chatsCount, chatsAffected, membersAffected, settingsAffected, bansAffected)
}

func migrateMessages(ctx context.Context, tx *sql.Tx) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO messages.messages (
			id, chat_id, sender_id, content, type, reply_to, content_encrypted,
			forwarded_message_id, created_at, updated_at, deleted_at
		)
		SELECT
			m.id,
			m.chat_id,
			m.sender_id,
			COALESCE(m.content, ''),
			COALESCE(m.type, 'text'),
			m.reply_to_message_id,
			COALESCE(m.is_encrypted, FALSE),
			m.forwarded_from,
			COALESCE(m.created_at, NOW()),
			COALESCE(m.edited_at, m.created_at, NOW()),
			m.deleted_at
		FROM public.messages m
		JOIN chats.chats c ON c.id = m.chat_id
		LEFT JOIN auth.users u ON u.id = m.sender_id
		ON CONFLICT (id) DO UPDATE SET
			content = EXCLUDED.content,
			type = EXCLUDED.type,
			content_encrypted = EXCLUDED.content_encrypted,
			forwarded_message_id = EXCLUDED.forwarded_message_id,
			updated_at = EXCLUDED.updated_at,
			deleted_at = EXCLUDED.deleted_at
	`)
	if err != nil {
		log.Fatalf("migrate messages: %v", err)
	}
	messagesAffected, _ := result.RowsAffected()

	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_reactions')`).Scan(&exists); err != nil {
		log.Fatalf("check message_reactions table: %v", err)
	}

	if exists {
		result, err = tx.ExecContext(ctx, `
			INSERT INTO messages.reactions (id, message_id, user_id, emoji, created_at)
			SELECT r.id, r.message_id, r.user_id, r.emoji, COALESCE(r.created_at, NOW())
			FROM public.message_reactions r
			JOIN messages.messages m ON m.id = r.message_id
			JOIN auth.users u ON u.id = r.user_id
			ON CONFLICT (message_id, user_id, emoji) DO NOTHING
		`)
		if err != nil {
			log.Fatalf("migrate message_reactions: %v", err)
		}
	} else {
		result, err = tx.ExecContext(ctx, `
			INSERT INTO messages.reactions (id, message_id, user_id, emoji, created_at)
			SELECT r.id, r.message_id, r.user_id, r.emoji, COALESCE(r.created_at, NOW())
			FROM public.reactions r
			JOIN messages.messages m ON m.id = r.message_id
			JOIN auth.users u ON u.id = r.user_id
			ON CONFLICT (message_id, user_id, emoji) DO NOTHING
		`)
		if err != nil {
			log.Printf("migrate reactions fallback failed: %v", err)
		}
	}
	var reactionsAffected int64
	if result != nil {
		reactionsAffected, _ = result.RowsAffected()
	}

	// Pinned messages
	result, err = tx.ExecContext(ctx, `
		INSERT INTO messages.pins (chat_id, message_id, pinned_by, pinned_at)
		SELECT m.chat_id, m.id, m.sender_id, m.pinned_at
		FROM public.messages m
		JOIN chats.chats c ON c.id = m.chat_id
		WHERE m.is_pinned = TRUE AND m.pinned_at IS NOT NULL
		ON CONFLICT (chat_id, message_id) DO NOTHING
	`)
	if err != nil {
		log.Fatalf("migrate pinned messages: %v", err)
	}
	pinsAffected, _ := result.RowsAffected()

	// Favorites
	var favsExists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='favorite_messages')`).Scan(&favsExists); err != nil {
		log.Fatalf("check favorite_messages table: %v", err)
	}
	var favsAffected int64
	if favsExists {
		result, err = tx.ExecContext(ctx, `
				INSERT INTO messages.favorites (user_id, message_id, created_at)
				SELECT mf.user_id, mf.message_id, COALESCE(mf.saved_at, NOW())
				FROM public.favorite_messages mf
			JOIN messages.messages m ON m.id = mf.message_id
			JOIN auth.users u ON u.id = mf.user_id
			ON CONFLICT DO NOTHING
		`)
		if err != nil {
			log.Fatalf("migrate favorite_messages: %v", err)
		}
		favsAffected, _ = result.RowsAffected()
	}

	fmt.Printf("messages: affected_messages=%d affected_reactions=%d affected_pins=%d affected_favorites=%d\n", messagesAffected, reactionsAffected, pinsAffected, favsAffected)
}

type legacyMediaRow struct {
	id             string
	uploaderID     string
	data           sql.NullString
	mimeType       sql.NullString
	sizeBytes      sql.NullInt64
	encrypted      bool
	encryptionJSON sql.NullString
	originalName   sql.NullString
	fileURL        sql.NullString
	createdAt      time.Time
}

func migrateMedia(ctx context.Context, tx *sql.Tx, apply bool) {
	gifsAffected := execRowsAffected(ctx, tx, "migrate gifs", `
		INSERT INTO media.gifs (id, user_id, name, url, created_at)
		SELECT g.id, g.user_id, COALESCE(g.name, ''), g.url, COALESCE(g.created_at, NOW())
		FROM public.gifs g
		LEFT JOIN auth.users u ON u.id = g.user_id
		WHERE g.url IS NOT NULL AND g.url <> ''
		  AND (g.user_id IS NULL OR u.id IS NOT NULL)
		ON CONFLICT (id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			name = EXCLUDED.name,
			url = EXCLUDED.url
	`)

	favoriteGifsAffected := execRowsAffected(ctx, tx, "migrate favorite gifs", `
		INSERT INTO media.favorite_gifs (id, user_id, gif_id, created_at)
		SELECT fg.id, fg.user_id, fg.gif_id, COALESCE(fg.created_at, NOW())
		FROM public.favorite_gifs fg
		JOIN auth.users u ON u.id = fg.user_id
		JOIN media.gifs g ON g.id = fg.gif_id
		ON CONFLICT (user_id, gif_id) DO UPDATE SET created_at = EXCLUDED.created_at
	`)

	packsAffected := execRowsAffected(ctx, tx, "migrate sticker packs", `
		INSERT INTO media.sticker_packs (id, user_id, name, description, icon_url, created_at, updated_at)
		SELECT sp.id, sp.user_id, sp.name, COALESCE(sp.description, ''), sp.icon_url,
		       COALESCE(sp.created_at, NOW()), COALESCE(sp.updated_at, sp.created_at, NOW())
		FROM public.sticker_packs sp
		JOIN auth.users u ON u.id = sp.user_id
		WHERE sp.name IS NOT NULL AND sp.name <> ''
		ON CONFLICT (id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			icon_url = EXCLUDED.icon_url,
			updated_at = EXCLUDED.updated_at
	`)

	stickersAffected := execRowsAffected(ctx, tx, "migrate stickers", `
		INSERT INTO media.stickers (id, pack_id, image_url, created_at)
		SELECT s.id, s.pack_id, s.image_url, COALESCE(s.created_at, NOW())
		FROM public.stickers s
		JOIN media.sticker_packs sp ON sp.id = s.pack_id
		WHERE s.image_url IS NOT NULL AND s.image_url <> ''
		ON CONFLICT (id) DO UPDATE SET
			pack_id = EXCLUDED.pack_id,
			image_url = EXCLUDED.image_url
	`)

	messageLinksAffected := execRowsAffected(ctx, tx, "migrate message attachments", `
		INSERT INTO messages.attachments (
			message_id, position, media_url, media_type, file_name,
			size_bytes, media_encrypted, media_encryption
		)
		SELECT target.id, 0, '/api/v2/media/' || mf.id::text,
		       COALESCE(legacy.media_type, ''), COALESCE(mf.original_name, ''),
		       COALESCE(mf.size_bytes, 0), COALESCE(mf.encrypted, FALSE),
		       mf.encryption
		FROM messages.messages target
		JOIN public.messages legacy ON target.id = legacy.id
		JOIN public.media_files mf ON mf.file_url = legacy.media_url
		WHERE legacy.media_url IS NOT NULL AND legacy.media_url <> ''
		ON CONFLICT (message_id, position) DO UPDATE SET
			media_url = EXCLUDED.media_url,
			media_type = EXCLUDED.media_type,
			file_name = EXCLUDED.file_name,
			size_bytes = EXCLUDED.size_bytes,
			media_encrypted = EXCLUDED.media_encrypted,
			media_encryption = EXCLUDED.media_encryption
	`)

	rows, err := tx.QueryContext(ctx, `
		SELECT mf.id::text
		FROM public.media_files mf
		JOIN auth.users u ON u.id = COALESCE(mf.user_id, mf.owner_id)
		ORDER BY mf.created_at, mf.id
	`)
	if err != nil {
		log.Fatalf("query legacy media files: %v", err)
	}
	defer rows.Close()

	var mediaIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			log.Fatalf("scan legacy media id: %v", err)
		}
		mediaIDs = append(mediaIDs, id)
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("iterate legacy media ids: %v", err)
	}
	if err := rows.Close(); err != nil {
		log.Fatalf("close legacy media id rows: %v", err)
	}

	if !apply {
		for _, id := range mediaIDs {
			row := loadLegacyMediaRow(ctx, tx, id)
			if _, _, err := readLegacyMedia(row, os.Getenv("LEGACY_UPLOADS_DIR")); err != nil {
				log.Fatalf("media dry-run validation failed for %s: %v", row.id, err)
			}
		}
		fmt.Printf(
			"media: dry-run files=%d gifs_affected=%d favorite_gifs_affected=%d packs_affected=%d stickers_affected=%d message_links_affected=%d (object uploads skipped)\n",
			len(mediaIDs), gifsAffected, favoriteGifsAffected, packsAffected, stickersAffected, messageLinksAffected,
		)
		return
	}

	var store *media.MinioStore
	bucket := envOrDefault("MEDIA_BUCKET", "crane-media")
	if len(mediaIDs) > 0 {
		store = media.NewMinioStore(
			envOrDefault("MINIO_ENDPOINT", "http://127.0.0.1:9000"),
			envOrDefault("MINIO_ACCESS_KEY", "craneapp"),
			envOrDefault("MINIO_SECRET_KEY", "craneapp-local-secret"),
			envOrDefault("MINIO_REGION", "us-east-1"),
		)
		if err := ensureLegacyMediaBucket(ctx, store, bucket); err != nil {
			log.Fatalf("ensure media bucket %q: %v", bucket, err)
		}
	}

	var uploadsAffected int64
	for _, id := range mediaIDs {
		row := loadLegacyMediaRow(ctx, tx, id)
		data, contentType, err := readLegacyMedia(row, os.Getenv("LEGACY_UPLOADS_DIR"))
		if err != nil {
			log.Fatalf("read legacy media %s: %v", row.id, err)
		}

		filename := legacyFilename(row)
		objectKey := legacyObjectKey(row, filename)
		if err := store.Put(ctx, bucket, objectKey, bytes.NewReader(data), int64(len(data)), contentType); err != nil {
			log.Fatalf("upload legacy media %s to object storage: %v", row.id, err)
		}

		encryptionMetadata := ""
		if row.encryptionJSON.Valid {
			encryptionMetadata = row.encryptionJSON.String
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO media.uploads
				(id, uploader_id, bucket, object_key, filename, content_type, size_bytes, is_encrypted, encryption_key_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (id) DO UPDATE SET
				uploader_id = EXCLUDED.uploader_id,
				bucket = EXCLUDED.bucket,
				object_key = EXCLUDED.object_key,
				filename = EXCLUDED.filename,
				content_type = EXCLUDED.content_type,
				size_bytes = EXCLUDED.size_bytes,
				is_encrypted = EXCLUDED.is_encrypted,
				encryption_key_id = EXCLUDED.encryption_key_id
		`, row.id, row.uploaderID, bucket, objectKey, filename, contentType, len(data), row.encrypted, encryptionMetadata, row.createdAt)
		if err != nil {
			log.Fatalf("insert migrated media upload %s: %v", row.id, err)
		}
		affected, _ := result.RowsAffected()
		uploadsAffected += affected
	}

	fmt.Printf(
		"media: uploads_affected=%d gifs_affected=%d favorite_gifs_affected=%d packs_affected=%d stickers_affected=%d message_links_affected=%d\n",
		uploadsAffected, gifsAffected, favoriteGifsAffected, packsAffected, stickersAffected, messageLinksAffected,
	)
}

func ensureLegacyMediaBucket(ctx context.Context, store *media.MinioStore, bucket string) error {
	var err error
	for attempt := 1; attempt <= 15; attempt++ {
		err = store.EnsureBucket(ctx, bucket)
		if err == nil {
			return nil
		}
		if attempt < 15 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Second):
			}
		}
	}
	return err
}

func loadLegacyMediaRow(ctx context.Context, tx *sql.Tx, id string) legacyMediaRow {
	var row legacyMediaRow
	err := tx.QueryRowContext(ctx, `
		SELECT mf.id::text,
		       COALESCE(mf.user_id, mf.owner_id)::text,
		       mf.data,
		       mf.mime_type,
		       COALESCE(mf.size_bytes, 0),
		       COALESCE(mf.encrypted, FALSE),
		       mf.encryption::text,
		       mf.original_name,
		       mf.file_url,
		       COALESCE(mf.created_at, NOW())
		FROM public.media_files mf
		JOIN auth.users u ON u.id = COALESCE(mf.user_id, mf.owner_id)
		WHERE mf.id = $1
	`, id).Scan(
		&row.id,
		&row.uploaderID,
		&row.data,
		&row.mimeType,
		&row.sizeBytes,
		&row.encrypted,
		&row.encryptionJSON,
		&row.originalName,
		&row.fileURL,
		&row.createdAt,
	)
	if err != nil {
		log.Fatalf("load legacy media file %s: %v", id, err)
	}
	return row
}

func execRowsAffected(ctx context.Context, tx *sql.Tx, name, statement string) int64 {
	result, err := tx.ExecContext(ctx, statement)
	if err != nil {
		log.Fatalf("%s: %v", name, err)
	}
	affected, _ := result.RowsAffected()
	return affected
}

func readLegacyMedia(row legacyMediaRow, uploadsDir string) ([]byte, string, error) {
	contentType := strings.TrimSpace(row.mimeType.String)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if row.data.Valid && strings.TrimSpace(row.data.String) != "" {
		value := strings.TrimSpace(row.data.String)
		if strings.HasPrefix(value, "data:") {
			comma := strings.IndexByte(value, ',')
			if comma < 0 {
				return nil, "", fmt.Errorf("malformed data URL")
			}
			header := value[:comma]
			if start := strings.Index(header, ":"); start >= 0 {
				if end := strings.Index(header, ";"); end > start {
					contentType = header[start+1 : end]
				}
			}
			value = value[comma+1:]
		}
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return nil, "", fmt.Errorf("decode base64 data: %w", err)
		}
		return decoded, contentType, nil
	}

	if !row.fileURL.Valid || strings.TrimSpace(row.fileURL.String) == "" {
		return nil, "", fmt.Errorf("neither embedded data nor file_url is available")
	}
	if strings.TrimSpace(uploadsDir) == "" {
		return nil, "", fmt.Errorf("LEGACY_UPLOADS_DIR is required for file_url %q", row.fileURL.String)
	}

	relative := strings.TrimPrefix(strings.TrimSpace(row.fileURL.String), "/uploads/")
	relative = strings.TrimPrefix(relative, "uploads/")
	clean := filepath.Clean(relative)
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return nil, "", fmt.Errorf("unsafe legacy file_url %q", row.fileURL.String)
	}
	root, err := filepath.Abs(uploadsDir)
	if err != nil {
		return nil, "", err
	}
	filename := filepath.Join(root, clean)
	if filename != root && !strings.HasPrefix(filename, root+string(filepath.Separator)) {
		return nil, "", fmt.Errorf("legacy file path escapes uploads root")
	}
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, "", fmt.Errorf("read %s: %w", filename, err)
	}
	if contentType == "application/octet-stream" {
		if detected := mime.TypeByExtension(filepath.Ext(filename)); detected != "" {
			contentType = detected
		}
	}
	return data, contentType, nil
}

func legacyFilename(row legacyMediaRow) string {
	if row.originalName.Valid && strings.TrimSpace(row.originalName.String) != "" {
		return filepath.Base(strings.TrimSpace(row.originalName.String))
	}
	if row.fileURL.Valid && strings.TrimSpace(row.fileURL.String) != "" {
		return filepath.Base(strings.TrimSpace(row.fileURL.String))
	}
	if ext, _ := mime.ExtensionsByType(strings.TrimSpace(row.mimeType.String)); len(ext) > 0 {
		return row.id + ext[0]
	}
	return row.id
}

func legacyObjectKey(row legacyMediaRow, filename string) string {
	ext := filepath.Ext(filename)
	return fmt.Sprintf("legacy/%s/%s%s", row.uploaderID, row.id, ext)
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
