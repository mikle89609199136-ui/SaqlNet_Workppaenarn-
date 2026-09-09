package media

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var stickerObjectKeyPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/stickers/[0-9]+$`)

type storageIdentity struct {
	Bucket    string
	ObjectKey string
}

func (identity storageIdentity) managed() bool {
	return identity.Bucket != "" && identity.ObjectKey != ""
}

func managedStickerURL(rawURL, endpoint, bucket, ownerID string) (storageIdentity, bool) {
	if rawURL == "" || endpoint == "" || bucket == "" || ownerID == "" {
		return storageIdentity{}, false
	}

	storageURL, err := url.Parse(endpoint)
	if err != nil || storageURL.Scheme == "" || storageURL.Host == "" || storageURL.User != nil || storageURL.RawQuery != "" || storageURL.Fragment != "" {
		return storageIdentity{}, false
	}
	objectURL, err := url.Parse(rawURL)
	if err != nil || objectURL.Scheme == "" || objectURL.Host == "" || objectURL.User != nil || objectURL.Fragment != "" {
		return storageIdentity{}, false
	}
	if !strings.EqualFold(objectURL.Scheme, storageURL.Scheme) || !strings.EqualFold(objectURL.Host, storageURL.Host) {
		return storageIdentity{}, false
	}

	query := objectURL.Query()
	required := map[string]string{
		"X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
		"X-Amz-Credential":    "",
		"X-Amz-Date":          "",
		"X-Amz-Expires":       "",
		"X-Amz-SignedHeaders": "",
		"X-Amz-Signature":     "",
	}
	for key, expected := range required {
		values := query[key]
		if len(values) != 1 || values[0] == "" || (expected != "" && values[0] != expected) {
			return storageIdentity{}, false
		}
	}

	prefix := strings.TrimRight(storageURL.Path, "/") + "/" + bucket + "/"
	if objectURL.RawPath != "" || !strings.HasPrefix(objectURL.Path, prefix) {
		return storageIdentity{}, false
	}
	objectKey := strings.TrimPrefix(objectURL.Path, prefix)
	if !stickerObjectKeyPattern.MatchString(objectKey) || !strings.HasPrefix(objectKey, ownerID+"/stickers/") {
		return storageIdentity{}, false
	}

	return storageIdentity{Bucket: bucket, ObjectKey: objectKey}, true
}

// BackfillStickerStorageIdentities marks only objects whose persisted URL
// exactly matches the currently configured MinIO endpoint, bucket, owner and
// sticker key layout. Ambiguous/shared and legacy URLs remain unmanaged.
func BackfillStickerStorageIdentities(ctx context.Context, db *sql.DB, endpoint, bucket string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('media.sticker_storage_backfill'))`); err != nil {
		return err
	}

	type candidate struct {
		kind     string
		id       string
		ownerID  string
		identity storageIdentity
	}
	var candidates []candidate
	identityCounts := make(map[storageIdentity]int)

	existingRows, err := tx.QueryContext(ctx, `
		SELECT icon_bucket, icon_object_key
		FROM media.sticker_packs
		WHERE icon_bucket IS NOT NULL AND icon_object_key IS NOT NULL
		UNION ALL
		SELECT bucket, object_key
		FROM media.stickers
		WHERE bucket IS NOT NULL AND object_key IS NOT NULL
	`)
	if err != nil {
		return err
	}
	for existingRows.Next() {
		var identity storageIdentity
		if err := existingRows.Scan(&identity.Bucket, &identity.ObjectKey); err != nil {
			existingRows.Close()
			return err
		}
		identityCounts[identity]++
	}
	if err := existingRows.Err(); err != nil {
		existingRows.Close()
		return err
	}
	if err := existingRows.Close(); err != nil {
		return err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT 'pack', sp.id::text, sp.user_id::text, sp.icon_url
		FROM media.sticker_packs sp
		WHERE sp.icon_url IS NOT NULL AND sp.icon_url <> ''
		  AND sp.icon_bucket IS NULL AND sp.icon_object_key IS NULL
		UNION ALL
		SELECT 'sticker', s.id::text, sp.user_id::text, s.image_url
		FROM media.stickers s
		JOIN media.sticker_packs sp ON sp.id = s.pack_id
		WHERE s.image_url <> '' AND s.bucket IS NULL AND s.object_key IS NULL
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var kind, id, ownerID, rawURL string
		if err := rows.Scan(&kind, &id, &ownerID, &rawURL); err != nil {
			rows.Close()
			return err
		}
		identity, ok := managedStickerURL(rawURL, endpoint, bucket, ownerID)
		if !ok {
			continue
		}
		candidates = append(candidates, candidate{kind: kind, id: id, ownerID: ownerID, identity: identity})
		identityCounts[identity]++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for _, item := range candidates {
		if identityCounts[item.identity] != 1 {
			continue
		}
		var result sql.Result
		if item.kind == "pack" {
			result, err = tx.ExecContext(ctx, `
				UPDATE media.sticker_packs
				SET icon_bucket = $2, icon_object_key = $3
				WHERE id = $1 AND icon_bucket IS NULL AND icon_object_key IS NULL
			`, item.id, item.identity.Bucket, item.identity.ObjectKey)
		} else if item.kind == "sticker" {
			result, err = tx.ExecContext(ctx, `
				UPDATE media.stickers
				SET bucket = $2, object_key = $3
				WHERE id = $1 AND bucket IS NULL AND object_key IS NULL
			`, item.id, item.identity.Bucket, item.identity.ObjectKey)
		} else {
			return fmt.Errorf("unknown sticker storage backfill kind %q", item.kind)
		}
		if err != nil {
			return err
		}
		if _, err := result.RowsAffected(); err != nil {
			return err
		}
	}

	return tx.Commit()
}
