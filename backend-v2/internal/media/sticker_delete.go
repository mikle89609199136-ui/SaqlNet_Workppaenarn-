package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
)

var (
	errStickerNotFound = errors.New("sticker not found")
	errPackNotFound    = errors.New("sticker pack not found")
)

func (s *Service) DeleteSticker(ctx context.Context, userID, stickerID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var bucket, objectKey sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT s.bucket, s.object_key
		FROM media.stickers s
		JOIN media.sticker_packs sp ON sp.id = s.pack_id
		WHERE s.id = $1 AND sp.user_id = $2
		FOR UPDATE OF s, sp
	`, stickerID, userID).Scan(&bucket, &objectKey)
	if errors.Is(err, sql.ErrNoRows) {
		return errStickerNotFound
	}
	if err != nil {
		return err
	}

	identity := nullableStorageIdentity(bucket, objectKey)
	if identity.managed() {
		if err := lockStorageIdentity(ctx, tx, identity); err != nil {
			return err
		}
		shared, err := objectReferencedOutsideSticker(ctx, tx, identity, stickerID)
		if err != nil {
			return err
		}
		if !shared {
			if err := enqueueObjectCleanup(ctx, tx, identity); err != nil {
				return err
			}
		}
	}

	result, err := tx.ExecContext(ctx, `DELETE FROM media.stickers WHERE id = $1`, stickerID)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted != 1 {
		return fmt.Errorf("delete sticker affected %d rows", deleted)
	}

	return tx.Commit()
}

func (s *Service) DeleteStickerPack(ctx context.Context, userID, packID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var iconBucket, iconObjectKey sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT icon_bucket, icon_object_key
		FROM media.sticker_packs
		WHERE id = $1 AND user_id = $2
		FOR UPDATE
	`, packID, userID).Scan(&iconBucket, &iconObjectKey)
	if errors.Is(err, sql.ErrNoRows) {
		return errPackNotFound
	}
	if err != nil {
		return err
	}

	var identities []storageIdentity
	seenIdentities := make(map[storageIdentity]struct{})
	addIdentity := func(identity storageIdentity) {
		if !identity.managed() {
			return
		}
		if _, exists := seenIdentities[identity]; exists {
			return
		}
		seenIdentities[identity] = struct{}{}
		identities = append(identities, identity)
	}
	iconIdentity := nullableStorageIdentity(iconBucket, iconObjectKey)
	addIdentity(iconIdentity)

	rows, err := tx.QueryContext(ctx, `
		SELECT bucket, object_key
		FROM media.stickers
		WHERE pack_id = $1
		FOR UPDATE
	`, packID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var bucket, objectKey sql.NullString
		if err := rows.Scan(&bucket, &objectKey); err != nil {
			rows.Close()
			return err
		}
		identity := nullableStorageIdentity(bucket, objectKey)
		addIdentity(identity)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	sort.Slice(identities, func(left, right int) bool {
		if identities[left].Bucket == identities[right].Bucket {
			return identities[left].ObjectKey < identities[right].ObjectKey
		}
		return identities[left].Bucket < identities[right].Bucket
	})
	for _, identity := range identities {
		if err := lockStorageIdentity(ctx, tx, identity); err != nil {
			return err
		}
		shared, err := objectReferencedOutsidePack(ctx, tx, identity, packID)
		if err != nil {
			return err
		}
		if shared {
			continue
		}
		if err := enqueueObjectCleanup(ctx, tx, identity); err != nil {
			return err
		}
	}

	result, err := tx.ExecContext(ctx, `DELETE FROM media.sticker_packs WHERE id = $1`, packID)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted != 1 {
		return fmt.Errorf("delete sticker pack affected %d rows", deleted)
	}

	return tx.Commit()
}

func nullableStorageIdentity(bucket, objectKey sql.NullString) storageIdentity {
	if !bucket.Valid || !objectKey.Valid {
		return storageIdentity{}
	}
	return storageIdentity{Bucket: bucket.String, ObjectKey: objectKey.String}
}

func lockStorageIdentity(ctx context.Context, tx *sql.Tx, identity storageIdentity) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, identity.Bucket, identity.ObjectKey)
	return err
}

func objectReferencedOutsideSticker(ctx context.Context, tx *sql.Tx, identity storageIdentity, stickerID string) (bool, error) {
	var shared bool
	err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM media.stickers
			WHERE bucket = $1 AND object_key = $2 AND id <> $3
			UNION ALL
			SELECT 1
			FROM media.sticker_packs
			WHERE icon_bucket = $1 AND icon_object_key = $2
		)
	`, identity.Bucket, identity.ObjectKey, stickerID).Scan(&shared)
	return shared, err
}

func objectReferencedOutsidePack(ctx context.Context, tx *sql.Tx, identity storageIdentity, packID string) (bool, error) {
	var shared bool
	err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM media.stickers
			WHERE bucket = $1 AND object_key = $2 AND pack_id <> $3
			UNION ALL
			SELECT 1
			FROM media.sticker_packs
			WHERE icon_bucket = $1 AND icon_object_key = $2 AND id <> $3
		)
	`, identity.Bucket, identity.ObjectKey, packID).Scan(&shared)
	return shared, err
}

func enqueueObjectCleanup(ctx context.Context, tx *sql.Tx, identity storageIdentity) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO media.object_cleanup_jobs (bucket, object_key)
		VALUES ($1, $2)
		ON CONFLICT (bucket, object_key) WHERE completed_at IS NULL DO NOTHING
	`, identity.Bucket, identity.ObjectKey)
	return err
}
