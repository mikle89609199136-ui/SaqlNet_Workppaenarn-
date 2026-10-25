//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Вложение сообщения — только загрузка самого отправителя, а конверт
// шифрования — из записи загрузки (#871).
func TestMediaAttachmentOnRealSchema(t *testing.T) {
	const (
		sender   = "aaaaaaaa-1111-4111-8111-111111111111"
		stranger = "bbbbbbbb-2222-4222-8222-222222222222"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, sender, "media_sender")
	dbtest.User(t, db, stranger, "media_stranger")
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, sender, stranger)
	require.NoError(t, err)

	const storedEnvelope = `{"encrypted":true,"version":2,"algorithm":"AES-GCM","iv":"AAAAAAAAAAAAAAAA","keyEpoch":1,"sizeBytes":5,"mimeType":"audio/ogg","fileName":"upload"}`
	upload := func(owner string, encrypted bool) string {
		var id string
		require.NoError(t, db.QueryRowContext(ctx, `
			INSERT INTO media.uploads (uploader_id, object_key, filename, content_type, size_bytes, is_encrypted, encryption_key_id)
			VALUES ($1, 'key', 'upload', 'application/octet-stream', 5, $2, $3)
			RETURNING id::text
		`, owner, encrypted, map[bool]string{true: storedEnvelope, false: ""}[encrypted]).Scan(&id))
		return id
	}
	own := upload(sender, true)
	foreign := upload(stranger, true)
	plain := upload(sender, false)

	send := func(item string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+chatID,
			strings.NewReader(`{"messages":[`+item+`]}`))
		req.SetPathValue("chatId", chatID)
		req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: sender}))
		rr := httptest.NewRecorder()
		NewHandler(chats).SendMessage(rr, req)
		return rr
	}
	media := func(url string, extra string) string {
		return `{"type":"voice","mediaUrl":"` + url + `","mediaType":"voice","mediaEncrypted":true` + extra + `}`
	}

	t.Run("чужой сервер — отклонено", func(t *testing.T) {
		rr := send(media("https://example.org/api/v2/media/"+own, ""))
		require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
		require.Contains(t, rr.Body.String(), "invalid_media_metadata")
	})

	t.Run("путь не к загрузке — отклонено", func(t *testing.T) {
		for _, url := range []string{"/api/v2/media/not-a-uuid", "/api/v2/users/me", "/api/v2/media/" + own + "/x", ""} {
			rr := send(media(url, ""))
			require.Equal(t, http.StatusBadRequest, rr.Code, url)
		}
	})

	t.Run("чужая загрузка — отклонено", func(t *testing.T) {
		rr := send(media("/api/v2/media/"+foreign, ""))
		require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	})

	t.Run("шифрованное против нешифрованной загрузки — отклонено", func(t *testing.T) {
		rr := send(media("/api/v2/media/"+plain, ""))
		require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	})

	t.Run("своя загрузка — конверт из записи, клиентский игнорируется", func(t *testing.T) {
		rr := send(media("/api/v2/media/"+own, `,"mediaEncryption":{"iv":"подмена","durationMs":12345}`))
		require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())

		var metadata []byte
		require.NoError(t, db.QueryRowContext(ctx,
			`SELECT metadata FROM messages.messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`, chatID,
		).Scan(&metadata))
		var parsed struct {
			MediaEncryption map[string]any `json:"mediaEncryption"`
		}
		require.NoError(t, json.Unmarshal(metadata, &parsed))
		require.Equal(t, "AAAAAAAAAAAAAAAA", parsed.MediaEncryption["iv"])
		require.NotContains(t, parsed.MediaEncryption, "durationMs", "поле клиента не должно попасть в сообщение")

		var attached bool
		require.NoError(t, db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM media.upload_refs r
				JOIN messages.messages m ON m.id = r.message_id
				JOIN media.uploads u ON u.id = r.upload_id
				WHERE r.upload_id = $1 AND r.kind = 'message' AND r.chat_id = $2
				AND m.chat_id = r.chat_id AND u.first_attached_at IS NOT NULL
			)`, own, chatID).Scan(&attached))
		require.True(t, attached)
	})
}
