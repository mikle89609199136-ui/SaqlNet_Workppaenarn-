package media

import (
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// An empty allowedType means the declared MIME must be rejected for plain media.
var mediaMIMECases = []struct {
	name        string
	raw         string
	allowedType string
}{
	{"jpeg", "image/jpeg", "image/jpeg"},
	{"png", "image/png", "image/png"},
	{"gif", "image/gif", "image/gif"},
	{"webp", "image/webp", "image/webp"},
	{"mp4", "video/mp4", "video/mp4"},
	{"video webm", "video/webm", "video/webm"},
	{"mpeg", "audio/mpeg", "audio/mpeg"},
	{"ogg", "audio/ogg", "audio/ogg"},
	{"audio webm", "audio/webm", "audio/webm"},
	{"pdf", "application/pdf", "application/pdf"},
	{"plain text", "text/plain", "text/plain"},
	{"uppercase", "IMAGE/PNG", "image/png"},
	{"parameters", "image/png; charset=utf-8", "image/png"},
	{"whitespace", " image/png ", "image/png"},
	{"mixed normalization", " TEXT/PLAIN; Charset=\"UTF-8\" ", "text/plain"},
	{"html", "text/html", ""},
	{"html parameters", " TEXT/HTML; charset=utf-8 ", ""},
	{"svg", "image/svg+xml", ""},
	{"svg uppercase", "IMAGE/SVG+XML", ""},
	{"xhtml", "application/xhtml+xml", ""},
	{"text xml", "text/xml", ""},
	{"application xml", "application/xml", ""},
	{"application javascript", "application/javascript", ""},
	{"text javascript", "text/javascript", ""},
	{"octet stream", "application/octet-stream", ""},
	{"unknown", "application/x-unknown", ""},
	{"malformed", "image/", ""},
	{"missing subtype", "image", ""},
	{"malformed parameter", "image/png; charset", ""},
	{"malformed quote", "image/png; charset=\"utf-8", ""},
	{"duplicate parameter", "image/png; charset=utf-8; charset=ascii", ""},
	{"empty", "", ""},
}

func TestNormalizeMediaType(t *testing.T) {
	for _, tt := range []struct {
		raw  string
		want string
		ok   bool
	}{
		{"IMAGE/PNG", "image/png", true},
		{"image/png; charset=utf-8", "image/png", true},
		{" \timage/png \t", "image/png", true},
		{" TEXT/HTML; charset=UTF-8 ", "text/html", true},
		{"image/png; charset", "", false},
		{"image/", "", false},
		{"image", "", false},
		{"", "", false},
	} {
		t.Run(tt.raw, func(t *testing.T) {
			got, ok := normalizeMediaType(tt.raw)
			if got != tt.want || ok != tt.ok {
				t.Fatalf("normalizeMediaType(%q)=(%q, %v), want (%q, %v)", tt.raw, got, ok, tt.want, tt.ok)
			}
		})
	}
}

// Keep catch-all expectations pending so the matcher counts even unexpected SQL.
// sqlmock with no expectations alone would not record an ignored query error.
func newRejectedMIMEHandler(t *testing.T) (*Handler, func()) {
	t.Helper()
	dbCalls := 0
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error {
		dbCalls++
		return nil
	})))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.MatchExpectationsInOrder(false)
	mock.ExpectQuery("any SQL").WillReturnError(errors.New("unexpected DB query"))
	mock.ExpectExec("any SQL").WillReturnError(errors.New("unexpected DB exec"))
	store := &testStore{}
	handler := NewHandler(NewService(db, store, "uploads", defaultTestMaxUploadBytes))
	return handler, func() {
		t.Helper()
		if store.putCalls != 0 || store.deleteCalls != 0 || dbCalls != 0 {
			t.Fatalf("side effects: Store.Put=%d Store.Delete=%d DB queries=%d, want all 0", store.putCalls, store.deleteCalls, dbCalls)
		}
	}
}

func assertUnsupportedMIME(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusUnsupportedMediaType || body.Code != "unsupported_type" || body.Message != "file type not allowed" {
		t.Fatalf("status=%d body=%s, want 415 unsupported_type / file type not allowed", response.Code, response.Body.String())
	}
}

func expectMIMEUploadInsert(mock sqlmock.Sqlmock, contentType string, size int64, encrypted bool) {
	var metadata any = ""
	if encrypted {
		metadata = sqlmock.AnyArg()
	}
	mock.ExpectQuery("INSERT INTO media\\.uploads").
		WithArgs("user-id", "uploads", sqlmock.AnyArg(), "file.bin", contentType, size, encrypted, metadata).
		WillReturnRows(sqlmock.NewRows([]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
			AddRow(testUploadID, "user-id", "file.bin", contentType, size, "2026-01-01"))
}

func TestPlainUploadMIMEPolicyParity(t *testing.T) {
	for _, variant := range []struct {
		name    string
		request func(*testing.T, string, string, []byte) *http.Request
	}{
		{"JSON", dataURLUploadRequest},
		{"multipart", multipartUploadRequest},
	} {
		t.Run(variant.name, func(t *testing.T) {
			for _, tt := range mediaMIMECases {
				t.Run(tt.name, func(t *testing.T) {
					data := []byte("declared MIME only")
					request := variant.request(t, "file.bin", tt.raw, data)
					if tt.allowedType == "" {
						handler, assertNoPersistence := newRejectedMIMEHandler(t)
						response := executeUpload(handler, request)
						assertNoPersistence()
						assertUnsupportedMIME(t, response)
						return
					}
					handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
					expectMIMEUploadInsert(mock, tt.allowedType, int64(len(data)), false)
					got := performUpload(t, handler, request)
					if got["contentType"] != tt.allowedType || store.lastPutType != tt.allowedType || store.putCalls != 1 {
						t.Fatalf("response=%v Store.Put type=%q calls=%d", got, store.lastPutType, store.putCalls)
					}
					if err := mock.ExpectationsWereMet(); err != nil {
						t.Fatal(err)
					}
				})
			}
		})
	}
}

func TestJSONDataURLFormatBeforeMIMEValidation(t *testing.T) {
	for _, tt := range []struct {
		dataURL string
		status  int
		code    string
		message string
	}{
		{"data:text/plain,hello", 400, "invalid_file", "invalid data url"},
		{"data:text/plain;BASE64,aGk=", 400, "invalid_file", "invalid data url"},
		{"data:text/plain;base64", 400, "invalid_file", "invalid data url"},
		{"data:text/plain;base64;extra,aGk=", 400, "invalid_file", "invalid data url"},
		{"data:text/html,hello", 400, "invalid_file", "invalid data url"},
		{"data:text/html;base64,aGk=", 415, "unsupported_type", "file type not allowed"},
		{"data:text/plain;base64,aGk=", 201, "", ""},
	} {
		t.Run(tt.dataURL, func(t *testing.T) {
			var handler *Handler
			var verify func()
			if tt.status == http.StatusCreated {
				var mock sqlmock.Sqlmock
				handler, mock, _ = newMediaTestHandler(t, defaultTestMaxUploadBytes)
				expectMIMEUploadInsert(mock, "text/plain", 2, false)
				verify = func() {
					if err := mock.ExpectationsWereMet(); err != nil {
						t.Fatal(err)
					}
				}
			} else {
				handler, verify = newRejectedMIMEHandler(t)
			}
			payload, err := json.Marshal(map[string]string{"file": tt.dataURL, "fileName": "file.bin"})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v2/media", strings.NewReader(string(payload)))
			request.Header.Set("Content-Type", "application/json")
			response := executeUpload(handler, request)
			verify()
			var body struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != tt.status || body.Code != tt.code || body.Message != tt.message {
				t.Fatalf("status=%d body=%s, want %d %s / %s", response.Code, response.Body.String(), tt.status, tt.code, tt.message)
			}
		})
	}
}

func TestJSONRejectsMIMEBeforeBase64Decode(t *testing.T) {
	for _, tt := range mediaMIMECases {
		if tt.allowedType != "" {
			continue
		}
		t.Run(tt.name, func(t *testing.T) {
			handler, assertNoPersistence := newRejectedMIMEHandler(t)
			payload, err := json.Marshal(map[string]string{"file": "data:" + tt.raw + ";base64,!!!invalid-base64!!!"})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v2/media", strings.NewReader(string(payload)))
			request.Header.Set("Content-Type", "application/json")
			response := executeUpload(handler, request)
			assertNoPersistence()
			assertUnsupportedMIME(t, response)
		})
	}
}

func TestMultipartRejectsMIMEBeforeOpeningFile(t *testing.T) {
	handler, assertNoPersistence := newRejectedMIMEHandler(t)
	// This header has no backing file; opening it fails. MIME must win over that error.
	fh := &multipart.FileHeader{Filename: "file.html", Header: textproto.MIMEHeader{"Content-Type": {"text/html"}}}
	if _, err := handler.service.Upload(context.Background(), "user-id", fh); !errors.Is(err, ErrBadType) {
		t.Fatalf("Service.Upload error=%v, want ErrBadType before fh.Open", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/media", nil)
	request.MultipartForm = &multipart.Form{File: map[string][]*multipart.FileHeader{"file": {fh}}}
	response := executeUpload(handler, request)
	assertNoPersistence()
	assertUnsupportedMIME(t, response)
}

func TestLegacyDownloadMIMEPolicy(t *testing.T) {
	for _, tt := range mediaMIMECases {
		t.Run(tt.name, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				t.Run(method, func(t *testing.T) {
					const data = "<html><script>alert('legacy')</script></html>"
					store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
						return objectResponse(http.StatusOK, data), nil
					}}
					handler, mock := newDownloadHandler(t, store, tt.raw, int64(len(data)), false, nil)
					response := serveDownload(t, handler, method, nil)
					wantType, wantDisposition := tt.allowedType, ""
					if wantType == "" {
						wantType, wantDisposition = "application/octet-stream", "attachment"
					}
					if response.Code != http.StatusOK || response.Header().Get("Content-Type") != wantType || response.Header().Get("Content-Disposition") != wantDisposition {
						t.Fatalf("status=%d headers=%v, want type=%q disposition=%q", response.Code, response.Header(), wantType, wantDisposition)
					}
					wantBody := data
					if method == http.MethodHead {
						wantBody = ""
					}
					if response.Body.String() != wantBody {
						t.Fatalf("body=%q, want %q", response.Body.String(), wantBody)
					}
					if err := mock.ExpectationsWereMet(); err != nil {
						t.Fatal(err)
					}
				})
			}
		})
	}
}

func TestDeclaredPNGWithHTMLBytesIsNotSniffed(t *testing.T) {
	for _, variant := range []struct {
		name    string
		request func(*testing.T, string, string, []byte) *http.Request
	}{
		{"JSON", dataURLUploadRequest},
		{"multipart", multipartUploadRequest},
	} {
		t.Run(variant.name, func(t *testing.T) {
			data := []byte("<!doctype html><html><script>alert('not a PNG')</script></html>")
			handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			expectMIMEUploadInsert(mock, "image/png", int64(len(data)), false)
			got := performUpload(t, handler, variant.request(t, "file.bin", "image/png", data))
			if got["contentType"] != "image/png" || store.lastPutType != "image/png" || string(store.lastPutData) != string(data) {
				t.Fatalf("declared PNG was changed: response=%v store=%+v", got, store)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
			download, downloadMock := newDownloadHandler(t, store, store.lastPutType, store.lastPutSize, false, nil)
			response := serveDownload(t, download, http.MethodGet, nil)
			if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" || response.Header().Get("Content-Disposition") != "" || response.Body.String() != string(data) {
				t.Fatalf("declared PNG download changed: status=%d headers=%v body=%q", response.Code, response.Header(), response.Body.String())
			}
			if err := downloadMock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestUploadRawCompensatesDBFailure(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name, contentType := "plain", "image/png"
		if encrypted {
			name, contentType = "encrypted", "text/html"
		}
		t.Run(name, func(t *testing.T) {
			handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			dbError := errors.New("insert failed")
			mock.ExpectQuery("INSERT INTO media\\.uploads").WillReturnError(dbError)
			_, err := handler.service.UploadRaw(context.Background(), "user-id", "file.bin", contentType, []byte("data"), encrypted, "")
			if !errors.Is(err, dbError) || store.putCalls != 1 || store.deleteCalls != 1 {
				t.Fatalf("err=%v Store.Put=%d Store.Delete=%d, want DB error and compensation", err, store.putCalls, store.deleteCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
