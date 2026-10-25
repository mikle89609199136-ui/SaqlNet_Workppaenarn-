package media

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestUploadPersistsNormalizedPurpose(t *testing.T) {
	for _, tt := range []struct{ input, stored string }{
		{"avatar", "avatar"}, {"gif", "gif"}, {"sticker", "sticker"},
		{"", "unknown"}, {"unknown", "unknown"}, {"legacy", "unknown"}, {"GIF", "unknown"},
	} {
		t.Run(tt.input, func(t *testing.T) {
			h, mock, _ := newMediaTestHandler(t, 1024)
			mock.ExpectQuery("INSERT INTO media.uploads .*purpose").
				WithArgs("user-id", "uploads", sqlmock.AnyArg(), "x.txt", "text/plain", 1, false, "", tt.stored).
				WillReturnRows(sqlmock.NewRows([]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
					AddRow("upload-id", "user-id", "x.txt", "text/plain", 1, "2026-01-01"))
			r := httptest.NewRequest(http.MethodPost, "/api/v2/media", strings.NewReader(fmt.Sprintf(`{"purpose":%q,"fileName":"x.txt","file":"data:text/plain;base64,eA=="}`, tt.input)))
			r.Header.Set("Content-Type", "application/json")
			performUpload(t, h, r)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestMultipartUploadPersistsPurpose(t *testing.T) {
	h, mock, _ := newMediaTestHandler(t, 1024)
	mock.ExpectQuery("INSERT INTO media.uploads .*purpose").
		WithArgs("user-id", "uploads", sqlmock.AnyArg(), "x.txt", "text/plain", 1, false, "", "avatar").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
			AddRow("upload-id", "user-id", "x.txt", "text/plain", 1, "2026-01-01"))
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "x.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("x"))
	_ = writer.WriteField("purpose", "avatar")
	_ = writer.Close()
	// CreateFormFile uses application/octet-stream; set an allowed declared type.
	raw := bytes.ReplaceAll(body.Bytes(), []byte("application/octet-stream"), []byte("text/plain"))
	r := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewReader(raw))
	r.Header.Set("Content-Type", writer.FormDataContentType())
	performUpload(t, h, r)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
