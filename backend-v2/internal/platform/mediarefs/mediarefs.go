// Package mediarefs records the uses that grant access to an upload.
package mediarefs

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
)

const URLPrefix = "/api/v2/media/"

type Kind string

const (
	Message    Kind = "message"
	Avatar     Kind = "avatar"
	ChatAvatar Kind = "chat_avatar"
	Gif        Kind = "gif"
	Sticker    Kind = "sticker"
)

type Ref struct {
	UploadID                                    string
	Kind                                        Kind
	MessageID, ChatID, UserID, GifID, StickerID string
}

type Execer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

var uploadIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func UploadIDFromURL(url string) (string, bool) {
	id, ok := strings.CutPrefix(url, URLPrefix)
	if !ok || !uploadIDPattern.MatchString(id) {
		return "", false
	}
	return id, true
}

// Add must share the caller's transaction with the entity being attached.
func Add(ctx context.Context, q Execer, ref Ref) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO media.upload_refs (upload_id, kind, message_id, chat_id, user_id, gif_id, sticker_id)
		VALUES ($1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid,
		        NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid)
		ON CONFLICT DO NOTHING
	`, ref.UploadID, ref.Kind, ref.MessageID, ref.ChatID, ref.UserID, ref.GifID, ref.StickerID)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, `UPDATE media.uploads SET first_attached_at = COALESCE(first_attached_at, NOW()) WHERE id = $1`, ref.UploadID)
	return err
}

// ReplaceOwner runs in the same transaction as the owner's avatar update.
func ReplaceOwner(ctx context.Context, q Execer, kind Kind, ownerID, uploadID string) error {
	ref := Ref{UploadID: uploadID, Kind: kind}
	var query string
	switch kind {
	case Avatar:
		query = `DELETE FROM media.upload_refs WHERE kind = 'avatar' AND user_id = $1`
		ref.UserID = ownerID
	case ChatAvatar:
		query = `DELETE FROM media.upload_refs WHERE kind = 'chat_avatar' AND chat_id = $1`
		ref.ChatID = ownerID
	default:
		return fmt.Errorf("unsupported media ref owner kind %q", kind)
	}
	if _, err := q.ExecContext(ctx, query, ownerID); err != nil {
		return err
	}
	if uploadID == "" {
		return nil
	}
	return Add(ctx, q, ref)
}
