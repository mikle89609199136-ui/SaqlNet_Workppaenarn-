package media

import (
	"context"
	"database/sql"
	"errors"

	"github.com/lib/pq"
)

func (s *Service) CanDownload(ctx context.Context, viewerID, uploadID string) error {
	var uploaderID string
	var attachedAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT uploader_id::text, first_attached_at FROM media.uploads WHERE id = $1`, uploadID).Scan(&uploaderID, &attachedAt)
	var pqErr *pq.Error
	if errors.Is(err, sql.ErrNoRows) || (errors.As(err, &pqErr) && pqErr.Code == "22P02") {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var hasLive, viewerAllowed bool
	err = s.db.QueryRowContext(ctx, `
		SELECT COALESCE(bool_or(live), false), COALESCE(bool_or(live AND allowed), false)
		FROM (
			SELECT r.kind <> 'message' OR (m.id IS NOT NULL AND m.deleted_at IS NULL) AS live,
			       r.kind <> 'message' OR EXISTS (
			           SELECT 1 FROM chats.members cm WHERE cm.chat_id = r.chat_id AND cm.user_id = $2
			       ) AS allowed
			FROM media.upload_refs r
			LEFT JOIN messages.messages m ON m.id = r.message_id
			WHERE r.upload_id = $1
		) refs
	`, uploadID, viewerID).Scan(&hasLive, &viewerAllowed)
	if err != nil {
		return err
	}
	if hasLive && viewerAllowed {
		return nil
	}
	if !hasLive && !attachedAt.Valid && viewerID == uploaderID {
		return nil
	}
	return ErrForbidden
}
