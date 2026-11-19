//go:build integration

package user

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

// newStorageAPI поднимает настоящий PostgreSQL с миграциями и HTTP-сервер,
// где Storage вызывается с фиксированным владельцем сессии.
func newStorageAPI(t *testing.T, userID string) (*sql.DB, *httptest.Server) {
	t.Helper()
	db := dbtest.Postgres(t)
	dbtest.User(t, db, userID, "storage_"+userID[len(userID)-4:])
	h := NewHandler(NewService(db), nil)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Storage(w, r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: userID})))
	}))
	t.Cleanup(server.Close)
	return db, server
}

// insertUpload вставляет загрузку с уникальным object_key; uploaderID == nil
// даёт NULL uploader_id (миграция 0049 разрешает).
func insertUpload(t *testing.T, db *sql.DB, uploaderID *string, contentType string, sizeBytes int64, purpose string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO media.uploads (uploader_id, bucket, object_key, filename, content_type, size_bytes, purpose)
		VALUES ($1, 'crane-media', 'key-' || gen_random_uuid()::text, '', $2, $3, $4)`,
		uploaderID, contentType, sizeBytes, purpose)
	require.NoError(t, err)
}

// insertMessage заводит групповой чат и сообщение; chats.members не нужен.
func insertMessage(t *testing.T, db *sql.DB, senderID, content string) {
	t.Helper()
	var chatID string
	require.NoError(t, db.QueryRow(`INSERT INTO chats.chats (type, title, owner_id) VALUES ('group', 'storage', $1) RETURNING id::text`, senderID).Scan(&chatID))
	_, err := db.Exec(`INSERT INTO messages.messages (chat_id, sender_id, content) VALUES ($1, $2, $3)`, chatID, senderID, content)
	require.NoError(t, err)
}

// fetchStorage выполняет GET /users/storage и разбирает storage из тела.
func fetchStorage(t *testing.T, server *httptest.Server) StorageUsage {
	t.Helper()
	res, err := server.Client().Get(server.URL + "/api/v2/users/storage")
	require.NoError(t, err)
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, res.StatusCode, string(body))
	var payload struct {
		Storage StorageUsage `json:"storage"`
	}
	require.NoError(t, json.Unmarshal(body, &payload))
	require.NotContains(t, string(body), `"media":null`)
	require.NotContains(t, string(body), `"files":null`)
	return payload.Storage
}

func TestStorageUsageAggregates(t *testing.T) {
	userID := "76000000-0000-4000-8000-000000000001"
	cases := []struct {
		name string
		seed func(t *testing.T, db *sql.DB)
		want StorageUsage
	}{
		{name: "empty"},
		{name: "repro431", seed: func(t *testing.T, db *sql.DB) {
			insertMessage(t, db, userID, "0123456789")
			insertUpload(t, db, &userID, "image/jpeg", 12345, "message")
		}, want: StorageUsage{Messages: 10, Media: 12345}},
		{name: "foreignUpload", seed: func(t *testing.T, db *sql.DB) {
			foreignID := "76000000-0000-4000-8000-000000000002"
			dbtest.User(t, db, foreignID, "storage_foreign")
			insertUpload(t, db, &foreignID, "image/jpeg", 555, "message")
		}},
		{name: "nullUploader", seed: func(t *testing.T, db *sql.DB) {
			insertUpload(t, db, nil, "image/jpeg", 4242, "message")
		}},
		{name: "avatarOnly", seed: func(t *testing.T, db *sql.DB) {
			insertUpload(t, db, &userID, "image/jpeg", 777, "avatar")
		}},
		{name: "filesSplit", seed: func(t *testing.T, db *sql.DB) {
			insertUpload(t, db, &userID, "image/jpeg", 500, "message")
			insertUpload(t, db, &userID, "application/zip", 999, "message")
		}, want: StorageUsage{Media: 500, Files: 999}},
		{name: "multibyte", seed: func(t *testing.T, db *sql.DB) {
			insertMessage(t, db, userID, "привет")
		}, want: StorageUsage{Messages: 6}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			db, server := newStorageAPI(t, userID)
			if tt.seed != nil {
				tt.seed(t, db)
			}
			require.Equal(t, tt.want, fetchStorage(t, server))
		})
	}
}

func TestStorageUsageDropsAfterUploadDelete(t *testing.T) {
	userID := "76000000-0000-4000-8000-000000000001"
	db, server := newStorageAPI(t, userID)
	insertUpload(t, db, &userID, "image/jpeg", 12345, "message")
	require.Equal(t, StorageUsage{Media: 12345}, fetchStorage(t, server))
	_, err := db.Exec(`DELETE FROM media.uploads WHERE uploader_id = $1`, userID)
	require.NoError(t, err)
	require.Equal(t, StorageUsage{}, fetchStorage(t, server))
}
