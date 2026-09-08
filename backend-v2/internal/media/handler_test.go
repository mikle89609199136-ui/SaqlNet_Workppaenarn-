package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/DATA-DOG/go-sqlmock"
)

type testStore struct {
	putCalls    int
	deleteCalls int
	lastPutSize int64
}

func (s *testStore) Put(_ context.Context, _, _ string, reader io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	s.putCalls++
	s.lastPutSize = int64(len(data))
	return nil
}

func (*testStore) PresignGet(context.Context, string, string, time.Duration) (string, error) {
	return "https://storage.test/object", nil
}

func (s *testStore) Delete(context.Context, string, string) error {
	s.deleteCalls++
	return nil
}

const defaultTestMaxUploadBytes int64 = 1 << 20

func newMediaTestHandler(t *testing.T, maxUploadBytes int64) (*Handler, sqlmock.Sqlmock, *testStore) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store := &testStore{}
	return NewHandler(NewService(db, store, "uploads", maxUploadBytes)), mock, store
}

func expectUploadInsert(mock sqlmock.Sqlmock, filename, contentType string, size int64) {
	mock.ExpectQuery("INSERT INTO media\\.uploads").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
			AddRow("upload-id", "user-id", filename, contentType, size, "2026-01-01"))
}

func newUploadHandler(t *testing.T, filename, contentType string, size int64) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	handler, mock, _ := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	expectUploadInsert(mock, filename, contentType, size)
	return handler, mock
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

func uploadRequestWithUser(request *http.Request) *http.Request {
	return request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
}

func executeUpload(handler *Handler, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.Upload(response, uploadRequestWithUser(request))
	return response
}

func multipartUploadRequest(t *testing.T, filename, contentType string, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/media", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func dataURLUploadRequest(t *testing.T, filename, contentType string, data []byte) *http.Request {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"file":     "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data),
		"fileName": filename,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func encryptedUploadRequest(t *testing.T, filename, contentType string, data []byte) *http.Request {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"purpose": "message",
		"file": map[string]any{
			"version":    1,
			"algorithm":  "AES-GCM",
			"iv":         "aXY=",
			"ciphertext": base64.StdEncoding.EncodeToString(data),
			"mimeType":   contentType,
			"fileName":   filename,
			"sizeBytes":  len(data),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func assertFileTooLargeResponse(t *testing.T, response *httptest.ResponseRecorder, maxBytes int64) {
	t.Helper()
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "file_too_large" {
		t.Fatalf("code=%q, want file_too_large", body.Error.Code)
	}
	wantMessage := uploadLimitMessage(maxBytes)
	if body.Error.Message != wantMessage {
		t.Fatalf("message=%q, want %q", body.Error.Message, wantMessage)
	}
}

func TestUploadActualSizeBoundaries(t *testing.T) {
	const limit int64 = 8
	variants := []struct {
		name        string
		filename    string
		contentType string
		request     func(*testing.T, string, string, []byte) *http.Request
	}{
		{name: "multipart", filename: "boundary.pdf", contentType: "application/pdf", request: multipartUploadRequest},
		{name: "data URL", filename: "boundary.txt", contentType: "text/plain", request: dataURLUploadRequest},
		{name: "encrypted", filename: "boundary.bin", contentType: "application/octet-stream", request: encryptedUploadRequest},
	}
	tests := []struct {
		name       string
		size       int64
		wantStatus int
	}{
		{name: "limit minus one", size: limit - 1, wantStatus: http.StatusCreated},
		{name: "limit", size: limit, wantStatus: http.StatusCreated},
		{name: "limit plus one", size: limit + 1, wantStatus: http.StatusRequestEntityTooLarge},
	}

	for _, variant := range variants {
		t.Run(variant.name, func(t *testing.T) {
			for _, tt := range tests {
				t.Run(tt.name, func(t *testing.T) {
					handler, mock, store := newMediaTestHandler(t, limit)
					if tt.wantStatus == http.StatusCreated {
						expectUploadInsert(mock, variant.filename, variant.contentType, tt.size)
					}
					request := variant.request(t, variant.filename, variant.contentType, bytes.Repeat([]byte{'a'}, int(tt.size)))
					response := executeUpload(handler, request)

					if tt.wantStatus == http.StatusRequestEntityTooLarge {
						assertFileTooLargeResponse(t, response, limit)
						if store.putCalls != 0 {
							t.Fatalf("Store.Put calls=%d, want 0", store.putCalls)
						}
					} else {
						if response.Code != tt.wantStatus {
							t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
						}
						if store.putCalls != 1 || store.lastPutSize != tt.size {
							t.Fatalf("Store.Put calls=%d size=%d, want calls=1 size=%d", store.putCalls, store.lastPutSize, tt.size)
						}
					}
					if err := mock.ExpectationsWereMet(); err != nil {
						t.Fatal(err)
					}
				})
			}
		})
	}
}

func TestEncryptedUploadUsesDecodedCiphertextSizeInsteadOfClientSize(t *testing.T) {
	const limit int64 = 8
	handler, mock, store := newMediaTestHandler(t, limit)
	expectUploadInsert(mock, "secret.bin", "application/octet-stream", 1)
	payload, err := json.Marshal(map[string]any{
		"purpose": "message",
		"file": map[string]any{
			"ciphertext": "YQ==",
			"fileName":   "secret.bin",
			"sizeBytes":  999,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := executeUpload(handler, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if store.putCalls != 1 || store.lastPutSize != 1 {
		t.Fatalf("Store.Put calls=%d size=%d, want calls=1 size=1", store.putCalls, store.lastPutSize)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUploadHTTPBodyLimitsReturnFileTooLarge(t *testing.T) {
	const limit int64 = 8

	t.Run("data URL JSON", func(t *testing.T) {
		handler, mock, store := newMediaTestHandler(t, limit)
		body := `{"file":"data:text/plain;base64,` + strings.Repeat("A", int(handler.jsonBodyLimit())+1)
		request := httptest.NewRequest(http.MethodPost, "/api/v2/media", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		assertFileTooLargeResponse(t, executeUpload(handler, request), limit)
		if store.putCalls != 0 {
			t.Fatalf("Store.Put calls=%d, want 0", store.putCalls)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("encrypted JSON", func(t *testing.T) {
		handler, mock, store := newMediaTestHandler(t, limit)
		body := `{"purpose":"message","file":{"ciphertext":"` + strings.Repeat("A", int(handler.jsonBodyLimit())+1)
		request := httptest.NewRequest(http.MethodPost, "/api/v2/media", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		assertFileTooLargeResponse(t, executeUpload(handler, request), limit)
		if store.putCalls != 0 {
			t.Fatalf("Store.Put calls=%d, want 0", store.putCalls)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("multipart", func(t *testing.T) {
		handler, mock, store := newMediaTestHandler(t, limit)
		data := bytes.Repeat([]byte{'a'}, int(handler.multipartBodyLimit())+1)
		request := multipartUploadRequest(t, "large.pdf", "application/pdf", data)
		assertFileTooLargeResponse(t, executeUpload(handler, request), limit)
		if store.putCalls != 0 {
			t.Fatalf("Store.Put calls=%d, want 0", store.putCalls)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestMultipartUploadRemovesTemporaryFileAfterSizeRejection(t *testing.T) {
	const limit int64 = 8
	handler, mock, store := newMediaTestHandler(t, limit)
	request := multipartUploadRequest(t, "large.pdf", "application/pdf", bytes.Repeat([]byte{'a'}, int(limit+1)))
	request = uploadRequestWithUser(request)
	response := httptest.NewRecorder()
	handler.Upload(response, request)
	assertFileTooLargeResponse(t, response, limit)

	if request.MultipartForm == nil || len(request.MultipartForm.File["file"]) != 1 {
		t.Fatal("expected parsed multipart file")
	}
	file, err := request.MultipartForm.File["file"][0].Open()
	if err == nil {
		_ = file.Close()
		t.Fatal("temporary multipart file still exists after handler returned")
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("opening removed multipart file: %v", err)
	}
	if store.putCalls != 0 {
		t.Fatalf("Store.Put calls=%d, want 0", store.putCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUploadRejectsOversizedMetadataBeforePersistence(t *testing.T) {
	const limit int64 = 8
	tests := []struct {
		name    string
		request func(*testing.T) *http.Request
	}{
		{
			name: "plain filename",
			request: func(t *testing.T) *http.Request {
				return dataURLUploadRequest(t, strings.Repeat("a", maxFilenameBytes+1), "text/plain", []byte("a"))
			},
		},
		{
			name: "encrypted algorithm",
			request: func(t *testing.T) *http.Request {
				payload, err := json.Marshal(map[string]any{
					"purpose": "message",
					"file": map[string]any{
						"ciphertext": "YQ==",
						"algorithm":  strings.Repeat("a", maxEncryptionAlgorithmBytes+1),
					},
				})
				if err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewReader(payload))
				request.Header.Set("Content-Type", "application/json")
				return request
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock, store := newMediaTestHandler(t, limit)
			response := executeUpload(handler, tt.request(t))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if store.putCalls != 0 {
				t.Fatalf("Store.Put calls=%d, want 0", store.putCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestWrappedMaxBytesErrorIsRecognized(t *testing.T) {
	err := fmt.Errorf("parse request: %w", &http.MaxBytesError{Limit: 10})
	if !isMaxBytesError(err) {
		t.Fatal("expected wrapped MaxBytesError to be recognized")
	}
}

func TestBase64EncodedSize(t *testing.T) {
	const largestExactlyRepresentableDecodedSize = (math.MaxInt64 / 4) * 3
	tests := []struct {
		decoded int64
		encoded int64
	}{
		{decoded: 0, encoded: 0},
		{decoded: 1, encoded: 4},
		{decoded: 2, encoded: 4},
		{decoded: 3, encoded: 4},
		{decoded: 4, encoded: 8},
		{decoded: largestExactlyRepresentableDecodedSize, encoded: math.MaxInt64 - 3},
		{decoded: largestExactlyRepresentableDecodedSize + 1, encoded: math.MaxInt64},
		{decoded: math.MaxInt64, encoded: math.MaxInt64},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("%d bytes", tt.decoded), func(t *testing.T) {
			if got := base64EncodedSize(tt.decoded); got != tt.encoded {
				t.Fatalf("base64EncodedSize(%d)=%d, want %d", tt.decoded, got, tt.encoded)
			}
		})
	}
}

func TestUploadLimitMessageForConfigured100MiB(t *testing.T) {
	const maxFileSize int64 = 104857600
	if got := uploadLimitMessage(maxFileSize); got != "file exceeds 100 MB limit" {
		t.Fatalf("uploadLimitMessage()=%q", got)
	}
}
