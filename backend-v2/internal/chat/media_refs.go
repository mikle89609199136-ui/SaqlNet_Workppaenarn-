package chat

import (
	"context"
	"database/sql"
	"strings"

	"craneapp/backend-v2/internal/platform/mediarefs"
)

func groupAvatarUpload(ctx context.Context, tx *sql.Tx, actorID, avatarURL string) (string, error) {
	if !strings.HasPrefix(avatarURL, mediarefs.URLPrefix) {
		return "", nil
	}
	id, ok := mediarefs.UploadIDFromURL(avatarURL)
	if !ok {
		return "", ErrInvalidInput
	}
	var owned bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM media.uploads WHERE id = $1 AND uploader_id = $2)`, id, actorID).Scan(&owned); err != nil {
		return "", err
	}
	if !owned {
		return "", ErrInvalidInput
	}
	return id, nil
}
