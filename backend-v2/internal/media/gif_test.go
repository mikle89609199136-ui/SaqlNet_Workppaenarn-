package media

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	gifTestUploadID = "abcdef01-2345-6789-abcd-ef0123456789"
	gifTestURL      = "/api/v2/media/" + gifTestUploadID
	gifSourceQuery  = `SELECT content_type, is_encrypted FROM media\.uploads WHERE id = \$1 AND uploader_id = \$2`
	gifInsertQuery  = `INSERT INTO media\.gifs \(user_id, name, url\) VALUES \(\$1, \$2, \$3\) RETURNING id::text, name, url, created_at::text`
)

func executeCreateGif(handler *Handler, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/v2/gifs", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-ID", "gif-contract-test")
	response := httptest.NewRecorder()
	handler.CreateGif(response, uploadRequestWithUser(request))
	return response
}

func TestCreateGif(t *testing.T) {
	for _, tt := range []struct {
		name        string
		nameJSON    string
		wantName    string
		contentType string
	}{
		{"trimmed name", `,"name":"  подпись  "`, "подпись", "image/gif"},
		{"missing name", "", "", "image/gif"},
		{"blank name", `,"name":"   "`, "", "image/gif"},
		{"legacy content type parameters", "", "", "image/gif; charset=binary"},
		{"uppercase content type", "", "", "IMAGE/GIF"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			mock.ExpectQuery(gifSourceQuery).WithArgs(gifTestUploadID, "user-id").
				WillReturnRows(sqlmock.NewRows([]string{"content_type", "is_encrypted"}).AddRow(tt.contentType, false))
			mock.ExpectQuery(gifInsertQuery).WithArgs("user-id", tt.wantName, gifTestURL).
				WillReturnRows(sqlmock.NewRows([]string{"id", "name", "url", "created_at"}).
					AddRow("gif-id", tt.wantName, gifTestURL, "2026-09-27"))
			response := executeCreateGif(handler, `{"url":"`+gifTestURL+`"`+tt.nameJSON+`}`)
			if response.Code != http.StatusCreated {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			var body struct {
				Success bool `json:"success"`
				Gif     Gif  `json:"gif"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if !body.Success || body.Gif.ID != "gif-id" || body.Gif.Name != tt.wantName || body.Gif.URL != gifTestURL {
				t.Fatalf("unexpected response: %s", response.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCreateGifRejectsInvalidInputBeforeDatabase(t *testing.T) {
	validBody := `{"url":"` + gifTestURL + `"}`
	tests := []struct {
		name   string
		body   string
		status int
		code   string
	}{
		{"oversized JSON", `{"url":"` + strings.Repeat("a", int(gifCreateBodyLimitBytes)) + `"}`, 413, "request_too_large"},
		{"oversized trailing whitespace", validBody + strings.Repeat(" ", int(gifCreateBodyLimitBytes)), 413, "request_too_large"},
		{"invalid JSON", `{"url":`, 400, "invalid_json"},
		{"multiple JSON values", validBody + `{}`, 400, "invalid_json"},
		{"missing URL", `{}`, 400, "missing_url"},
		{"empty URL", `{"url":""}`, 400, "missing_url"},
		{"blank URL", `{"url":"   "}`, 400, "missing_url"},
		{"javascript", `{"url":"javascript:alert(1)"}`, 400, "invalid_url"},
		{"data", `{"url":"data:text/html,<script>alert(1)</script>"}`, 400, "invalid_url"},
		{"external https", `{"url":"https://example.com/a.gif"}`, 400, "invalid_url"},
		{"query", `{"url":"` + gifTestURL + `?x=1"}`, 400, "invalid_url"},
		{"fragment", `{"url":"` + gifTestURL + `#f"}`, 400, "invalid_url"},
		{"long URL", `{"url":"` + strings.Repeat("a", maxGifURLBytes+1) + `"}`, 400, "invalid_url"},
		{"long name", `{"url":"` + gifTestURL + `","name":"` + strings.Repeat("я", 256) + `"}`, 400, "validation_failed"},
		{"NUL name", `{"url":"` + gifTestURL + `","name":"a\u0000b"}`, 400, "validation_failed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			response := executeCreateGif(handler, tt.body)
			assertGifError(t, response, tt.status, tt.code)
			if tt.status == 413 && !strings.Contains(response.Body.String(), "request body exceeds 64 KiB limit") {
				t.Fatalf("unexpected size error: %s", response.Body.String())
			}
			if store.putCalls != 0 {
				t.Errorf("Store.Put calls=%d, want 0", store.putCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCreateGifRejectsInvalidSourceAndDatabaseErrors(t *testing.T) {
	const driverMessage = "pq: private driver error details"
	for _, tt := range []struct {
		name        string
		contentType string
		encrypted   bool
		missing     bool
		selectError bool
		insertError bool
		status      int
		code        string
	}{
		{name: "missing upload", missing: true, status: 404, code: "upload_not_found"},
		{name: "another user's upload", missing: true, status: 404, code: "upload_not_found"},
		{name: "PNG upload", contentType: "image/png", status: 400, code: "invalid_gif_source"},
		{name: "invalid content type parameters", contentType: "image/gif; broken", status: 400, code: "invalid_gif_source"},
		{name: "encrypted GIF", contentType: "image/gif", encrypted: true, status: 400, code: "invalid_gif_source"},
		{name: "SELECT error", selectError: true, status: 500, code: "internal_error"},
		{name: "INSERT error", contentType: "image/gif", insertError: true, status: 500, code: "internal_error"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			query := mock.ExpectQuery(gifSourceQuery).WithArgs(gifTestUploadID, "user-id")
			rows := sqlmock.NewRows([]string{"content_type", "is_encrypted"})
			switch {
			case tt.selectError:
				query.WillReturnError(errors.New(driverMessage))
			case tt.missing:
				query.WillReturnRows(rows)
			default:
				query.WillReturnRows(rows.AddRow(tt.contentType, tt.encrypted))
			}
			if tt.insertError {
				mock.ExpectQuery(gifInsertQuery).WithArgs("user-id", "", gifTestURL).
					WillReturnError(errors.New(driverMessage))
			}
			response := executeCreateGif(handler, `{"url":"`+gifTestURL+`"}`)
			assertGifError(t, response, tt.status, tt.code)
			if tt.status == 500 {
				var body map[string]string
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if body["message"] != "internal server error" || strings.Contains(response.Body.String(), driverMessage) {
					t.Fatalf("database error leaked: %s", response.Body.String())
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func assertGifError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status || response.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 3 || body["code"] != code || body["message"] == "" || body["requestId"] != "gif-contract-test" {
		t.Fatalf("unexpected error response: %s", response.Body.String())
	}
}
