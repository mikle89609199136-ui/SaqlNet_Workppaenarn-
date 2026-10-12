package media

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestStickerJSONLimits(t *testing.T) {
	const limit int64 = 1024
	variants := []struct {
		name  string
		path  string
		body  func(string) string
		isAdd bool
	}{
		{
			name: "create pack",
			path: "/api/v2/stickers/packs",
			body: func(image string) string { return `{"name":"Pack","icon":"` + image + `"}` },
		},
		{
			name:  "add sticker",
			path:  "/api/v2/stickers/packs/" + stickerTestPackID,
			body:  func(image string) string { return `{"image":"` + image + `"}` },
			isAdd: true,
		},
	}
	tests := []struct {
		name      string
		suffix    string
		imageSize int64
		oversized bool
		status    int
		code      string
	}{
		{name: "trailing object", suffix: `{"name":"second"}`, imageSize: 1, status: 400, code: "invalid_json"},
		{name: "trailing object and array", suffix: `{}[]`, imageSize: 1, status: 400, code: "invalid_json"},
		{name: "trailing garbage", suffix: ` not json at all`, imageSize: 1, status: 400, code: "invalid_json"},
		{name: "trailing whitespace", suffix: " \t\r\n", imageSize: 1, status: 201},
		{name: "body exceeds limit", imageSize: 1, oversized: true, status: 413, code: "request_too_large"},
		{name: "image at limit", imageSize: limit, status: 201},
		{name: "image exceeds limit", imageSize: limit + 1, status: 413, code: "file_too_large"},
	}
	for _, variant := range variants {
		t.Run(variant.name, func(t *testing.T) {
			for _, tt := range tests {
				t.Run(tt.name, func(t *testing.T) {
					handler, mock, store := newMediaTestHandler(t, limit)
					data := bytes.Repeat([]byte{'a'}, int(tt.imageSize))
					body := variant.body("data:image/png;base64,"+base64.StdEncoding.EncodeToString(data)) + tt.suffix
					if tt.oversized {
						// Valid JSON with trailing whitespace must still be read to EOF.
						body += strings.Repeat(" ", int(handler.jsonBodyLimit())+1-len(body))
					}
					if exceeds := int64(len(body)) > handler.jsonBodyLimit(); exceeds != tt.oversized {
						t.Fatalf("body size=%d limit=%d, want oversized=%t", len(body), handler.jsonBodyLimit(), tt.oversized)
					}
					if variant.isAdd && (tt.status == http.StatusCreated || tt.code == "file_too_large") {
						mock.ExpectQuery(`SELECT user_id::text FROM media\.sticker_packs WHERE id = \$1`).
							WithArgs(stickerTestPackID).
							WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(stickerTestUserID))
					}
					if tt.status == http.StatusCreated {
						if variant.isAdd {
							mock.ExpectQuery(`INSERT INTO media\.stickers`).
								WithArgs(stickerTestPackID, "https://storage.test/object", "uploads", sqlmock.AnyArg()).
								WillReturnRows(sqlmock.NewRows([]string{"id", "image_url", "created_at"}).
									AddRow(stickerTestID, "https://storage.test/object", "2026-09-28"))
						} else {
							mock.ExpectQuery(`INSERT INTO media\.sticker_packs`).
								WithArgs(stickerTestUserID, "Pack", "", "https://storage.test/object", "uploads", sqlmock.AnyArg()).
								WillReturnRows(sqlmock.NewRows([]string{"id", "name", "description", "icon_url", "created_at"}).
									AddRow(stickerTestPackID, "Pack", "", "https://storage.test/object", "2026-09-28"))
						}
					}
					request := stickerCreateRequest(variant.path, body)
					request.Header.Set("Content-Type", "application/json")
					request.Header.Set("X-Request-ID", "sticker-json-test")
					response := httptest.NewRecorder()
					handler.HandleStickersRoutes(response, request)
					if err := mock.ExpectationsWereMet(); err != nil {
						t.Error(err)
					}
					if response.Code != tt.status {
						t.Fatalf("status=%d, want %d: %s", response.Code, tt.status, response.Body.String())
					}
					if tt.status == http.StatusCreated {
						if store.putCalls != 1 || store.lastPutSize != tt.imageSize {
							t.Errorf("Store.Put calls=%d size=%d, want 1 and %d", store.putCalls, store.lastPutSize, tt.imageSize)
						}
						return
					}
					if store.putCalls != 0 {
						t.Errorf("Store.Put calls=%d, want 0", store.putCalls)
					}
					message := "invalid json"
					switch tt.code {
					case "request_too_large":
						message = requestLimitMessage(handler.jsonBodyLimit())
					case "file_too_large":
						message = uploadLimitMessage(limit)
					}
					assertStickerJSONError(t, response, tt.code, message, request.Header.Get("X-Request-ID"))
				})
			}
		})
	}
}

func assertStickerJSONError(t *testing.T, response *httptest.ResponseRecorder, code, message, requestID string) {
	t.Helper()
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type=%q, want application/json", got)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["error"]; exists {
		t.Fatal("unexpected nested error envelope")
	}
	if len(fields) != 3 {
		t.Fatalf("expected exactly three root fields: %s", response.Body.String())
	}
	for key, want := range map[string]string{"code": code, "message": message, "requestId": requestID} {
		var got string
		if err := json.Unmarshal(fields[key], &got); err != nil {
			t.Fatalf("field %s: %v", key, err)
		}
		if got != want {
			t.Errorf("%s=%q, want %q", key, got, want)
		}
	}
}
