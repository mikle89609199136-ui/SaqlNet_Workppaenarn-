package media

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// The same fixtures are validated against OpenAPI by frontend's api:check.
// These tests bind them to real handlers (DB and object storage are mocked).
func TestMediaAPIContract(t *testing.T) {
	var fixtures []struct {
		Name        string          `json:"name"`
		OperationID string          `json:"operationId"`
		Status      int             `json:"status"`
		Body        json.RawMessage `json:"body"`
	}
	data, err := os.ReadFile("../../contracts/openapi/fixtures/media-api.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	const timestamp = "2026-10-28 10:20:30.123456+00"
	const gifID = gifTestUploadID
	const mediaURL = "/api/v2/media/" + testUploadID
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			response := httptest.NewRecorder()
			method, path, body := http.MethodGet, "/api/v2/", ""
			var serve http.HandlerFunc
			switch fixture.OperationID {
			case "listEmojis":
				serve = ServeEmojis
				if fixture.Status == http.StatusMethodNotAllowed {
					method = http.MethodPost
				}
			case "uploadMedia":
				method, path = http.MethodPost, "/api/v2/media"
				body = `{"file":"data:text/plain;base64,aGVsbG8=","fileName":"note.txt"}`
				filename, contentType, size := "note.txt", "text/plain", 5
				if fixture.Name == "encrypted-upload" {
					body = `{"purpose":"message","file":{"version":2,"encrypted":true,"algorithm":"AES-GCM","iv":"AAECAwQFBgcICQoL","keyEpoch":1,"ciphertext":"Y2lwaGVy","mimeType":"application/pdf","fileName":"secret.pdf","sizeBytes":42}}`
					filename, contentType, size = "secret.pdf", "application/pdf", 6
				}
				mock.ExpectQuery("INSERT INTO media.uploads").WillReturnRows(sqlmock.NewRows(
					[]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
					AddRow(testUploadID, "user-id", filename, contentType, size, timestamp))
				serve = handler.Upload
			case "getMedia":
				store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
					return objectResponse(http.StatusOK, "cipher"), nil
				}}
				handler, mock = newDownloadHandler(t, store, "application/pdf", 6, true,
					`{"version":1,"mimeType":"application/pdf","sizeBytes":42}`)
				path, serve = "/api/v2/media/"+testUploadID, handler.Serve
			case "listGifs", "listFavoriteGifs":
				rows := sqlmock.NewRows([]string{"id", "name", "url", "username", "created_at"})
				if !strings.HasSuffix(fixture.Name, "-empty") {
					rows.AddRow(gifID, "GIF", mediaURL, "alice", timestamp)
				}
				mock.ExpectQuery("SELECT g.id::text").WillReturnRows(rows)
				serve = handler.ListGifs
				if fixture.OperationID == "listFavoriteGifs" {
					serve = handler.ListFavoriteGifs
				}
			case "createGif":
				method, path, serve = http.MethodPost, "/api/v2/gifs", handler.CreateGif
				body = `{"url":"` + mediaURL + `","name":"GIF"}`
				if fixture.Status == http.StatusBadRequest {
					body = `{`
					break
				}
				mock.ExpectQuery(gifSourceQuery).WillReturnRows(sqlmock.NewRows(
					[]string{"content_type", "is_encrypted"}).AddRow("image/gif", false))
				mock.ExpectBegin()
				mock.ExpectQuery(gifInsertQuery).WillReturnRows(sqlmock.NewRows(
					[]string{"id", "name", "url", "created_at"}).AddRow(gifID, "GIF", mediaURL, timestamp))
				mock.ExpectExec("INSERT INTO media.upload_refs").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec("UPDATE media.uploads SET first_attached_at").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			case "favoriteGif", "unfavoriteGif":
				method, path, serve = http.MethodPost, "/api/v2/gifs/"+gifID+"/favorite", handler.ToggleFavoriteGif
				if fixture.OperationID == "unfavoriteGif" {
					method = http.MethodDelete
				}
				mock.ExpectQuery("WITH gif AS").WillReturnRows(sqlmock.NewRows(
					[]string{"exists", "changed"}).AddRow(fixture.Status != 404, fixture.Status == 201))
			case "listStickerPacks":
				rows := sqlmock.NewRows([]string{"id", "name", "description", "icon_url", "count", "created_at"})
				if !strings.HasSuffix(fixture.Name, "-empty") {
					rows.AddRow(stickerTestPackID, "Pack", "", "", 0, timestamp)
				}
				mock.ExpectQuery("SELECT sp.id::text").WillReturnRows(rows)
				serve = handler.ListStickerPacks
			case "listStickers":
				rows := sqlmock.NewRows([]string{"id", "image_url", "created_at"})
				if !strings.HasSuffix(fixture.Name, "-empty") {
					rows.AddRow(stickerTestID, "/api/v2/media/"+stickerTestID, timestamp)
				}
				mock.ExpectQuery("SELECT id::text").WillReturnRows(rows)
				path, serve = "/api/v2/stickers/packs/"+stickerTestPackID, handler.GetStickers
			case "createStickerPack":
				mock.ExpectQuery("INSERT INTO media.sticker_packs").WillReturnRows(sqlmock.NewRows(
					[]string{"id", "name", "description", "icon_url", "created_at"}).
					AddRow(stickerTestPackID, "Pack", "", "", timestamp))
				method, body, serve = http.MethodPost, `{"name":"Pack","description":null,"icon":null}`, handler.CreateStickerPack
			case "addSticker":
				mock.ExpectQuery("SELECT user_id::text FROM media.sticker_packs").WillReturnRows(
					sqlmock.NewRows([]string{"user_id"}).AddRow("user-id"))
				mock.ExpectQuery("INSERT INTO media.stickers").WillReturnRows(sqlmock.NewRows(
					[]string{"id", "image_url", "created_at"}).AddRow(stickerTestID, "https://storage.test/object", timestamp))
				method, path, body, serve = http.MethodPost, "/api/v2/stickers/packs/"+stickerTestPackID,
					`{"image":"`+stickerTestDataURL+`"}`, handler.AddSticker
			case "deleteStickerPack":
				mock.ExpectBegin()
				mock.ExpectQuery("SELECT icon_bucket, icon_object_key").WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
				method, path, serve = http.MethodDelete, "/api/v2/stickers/packs/"+stickerTestPackID, handler.DeleteStickerPack
			case "deleteSticker":
				mock.ExpectBegin()
				mock.ExpectQuery("SELECT s.bucket, s.object_key").WillReturnRows(
					sqlmock.NewRows([]string{"bucket", "object_key"}).AddRow(nil, nil))
				mock.ExpectExec("DELETE FROM media.stickers").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
				method, path, serve = http.MethodDelete, "/api/v2/stickers/"+stickerTestID, handler.DeleteSticker
			default:
				t.Fatalf("fixture has no runtime check: %s", fixture.OperationID)
			}
			request := httptest.NewRequest(method, path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Request-ID", "media-contract-test")
			serve(response, uploadRequestWithUser(request))
			var got, want any
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(fixture.Body, &want); err != nil {
				t.Fatal(err)
			}
			if response.Code != fixture.Status || !reflect.DeepEqual(got, want) {
				t.Fatalf("status=%d body=%s; want status=%d body=%s", response.Code, response.Body.String(), fixture.Status, fixture.Body)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
