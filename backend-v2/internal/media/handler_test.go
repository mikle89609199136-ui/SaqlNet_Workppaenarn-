package media

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/DATA-DOG/go-sqlmock"
)

type testStore struct{}

func (testStore) Put(context.Context, string, string, io.Reader, int64, string) error { return nil }
func (testStore) PresignGet(context.Context, string, string, time.Duration) (string, error) {
	return "https://storage.test/object", nil
}
func (testStore) Delete(context.Context, string, string) error { return nil }

func newUploadHandler(t *testing.T, filename, contentType string, size int64) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mock.ExpectQuery("INSERT INTO media\\.uploads").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
			AddRow("upload-id", "user-id", filename, contentType, size, "2026-01-01"))
	return NewHandler(NewService(db, testStore{}, "uploads")), mock
}

func performUpload(t *testing.T, handler *Handler, request *http.Request) map[string]any {
	t.Helper()
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()
	handler.Upload(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestMultipartUploadReturnsFileMetadata(t *testing.T) {
	handler, mock := newUploadHandler(t, "report.pdf", "application/pdf", 3)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="C:\\secret\\report.pdf"`)
	header.Set("Content-Type", "application/pdf")
	part, _ := writer.CreatePart(header)
	_, _ = part.Write([]byte("pdf"))
	_ = writer.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/media", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	got := performUpload(t, handler, req)
	if got["fileName"] != "report.pdf" || got["sizeBytes"] != float64(3) || got["contentType"] != "application/pdf" {
		t.Fatalf("unexpected response: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestJSONUploadReturnsFileMetadata(t *testing.T) {
	handler, mock := newUploadHandler(t, "note.txt", "text/plain", 5)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewBufferString(`{"file":"data:text/plain;base64,aGVsbG8=","fileName":"../note.txt"}`))
	req.Header.Set("Content-Type", "application/json")
	got := performUpload(t, handler, req)
	if got["fileName"] != "note.txt" || got["sizeBytes"] != float64(5) {
		t.Fatalf("unexpected response: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEncryptedUploadReturnsOriginalMetadata(t *testing.T) {
	handler, mock := newUploadHandler(t, "secret.pdf", "application/pdf", 6)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewBufferString(`{"purpose":"message","file":{"ciphertext":"Y2lwaGVy","mimeType":"application/pdf","fileName":"/tmp/secret.pdf","sizeBytes":245760}}`))
	req.Header.Set("Content-Type", "application/json")
	got := performUpload(t, handler, req)
	if got["fileName"] != "secret.pdf" || got["sizeBytes"] != float64(245760) || got["encrypted"] != true {
		t.Fatalf("unexpected response: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
