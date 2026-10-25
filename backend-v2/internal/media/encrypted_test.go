package media

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func validEncryptedFile() map[string]any {
	return map[string]any{
		"encrypted": true, "version": 2, "algorithm": "AES-GCM",
		"iv": "AAECAwQFBgcICQoL", "keyEpoch": 5, "sizeBytes": 999,
		"ciphertext": "Y2lwaGVy", "mimeType": "text/html", "fileName": "file.bin",
	}
}

func envelopeRequest(t *testing.T, file any, filename string) *http.Request {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"purpose": "message", "file": file, "fileName": filename})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/media", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func assertEnvelopeRejected(t *testing.T, file any, code string) {
	t.Helper()
	// Pending catch-all expectations count SQL even if its error were ignored.
	dbCalls := 0
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error {
		dbCalls++
		return nil
	})))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(false)
	mock.ExpectQuery("any SQL").WillReturnError(errors.New("unexpected query"))
	mock.ExpectExec("any SQL").WillReturnError(errors.New("unexpected exec"))
	store := &testStore{}
	handler := NewHandler(NewService(db, store, "uploads", defaultTestMaxUploadBytes))
	response := executeUpload(handler, envelopeRequest(t, file, ""))
	if store.putCalls != 0 || dbCalls != 0 {
		t.Fatalf("Store.Put=%d DB calls=%d, want both 0", store.putCalls, dbCalls)
	}
	var body struct{ Code string }
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusBadRequest || body.Code != code {
		t.Fatalf("status=%d body=%s, want 400 %s", response.Code, response.Body.String(), code)
	}
}

func TestEncryptedEnvelopeRejectsWrongFieldTypes(t *testing.T) {
	for _, field := range []struct{ name, kind, code string }{
		{"encrypted", "bool", "validation_failed"},
		{"version", "integer", "validation_failed"},
		{"algorithm", "string", "validation_failed"},
		{"iv", "string", "validation_failed"},
		{"keyEpoch", "integer", "validation_failed"},
		{"sizeBytes", "integer", "invalid_size"},
		{"ciphertext", "string", "invalid_ciphertext"},
		{"mimeType", "string", "validation_failed"},
		{"fileName", "string", "validation_failed"},
	} {
		for _, value := range []struct {
			kind string
			data any
		}{
			{"null", nil}, {"bool", true}, {"integer", 2}, {"fraction", 1.5},
			{"string", "1"}, {"array", []any{}}, {"object", map[string]any{}},
		} {
			if value.kind == field.kind {
				continue
			}
			t.Run(field.name+"/"+value.kind, func(t *testing.T) {
				file := validEncryptedFile()
				file[field.name] = value.data
				assertEnvelopeRejected(t, file, field.code)
			})
		}
	}
}

func TestEncryptedEnvelopeRequiresAllFields(t *testing.T) {
	for _, field := range []string{"encrypted", "version", "algorithm", "iv", "keyEpoch", "sizeBytes", "ciphertext"} {
		t.Run(field, func(t *testing.T) {
			file := validEncryptedFile()
			delete(file, field)
			assertEnvelopeRejected(t, file, "validation_failed")
		})
	}
	for _, file := range []any{nil, true, 1, "cipher", []any{}, map[string]any{"ciphertext": "YQ=="}} {
		assertEnvelopeRejected(t, file, "validation_failed")
	}
}

func TestEncryptedEnvelopeRejectsInvalidValues(t *testing.T) {
	for _, tt := range []struct {
		name, field string
		value       any
		code        string
	}{
		{"false", "encrypted", false, "validation_failed"},
		{"string true", "encrypted", "true", "validation_failed"},
		{"v1", "version", 1, "validation_failed"},
		{"v3", "version", 3, "validation_failed"},
		{"algorithm case", "algorithm", "aes-gcm", "validation_failed"},
		{"iv invalid", "iv", "!!!", "validation_failed"},
		{"iv URL alphabet", "iv", "________________", "validation_failed"},
		{"iv newline", "iv", "AAECAwQF\nBgcICQoL", "validation_failed"},
		{"iv 11 bytes", "iv", base64.StdEncoding.EncodeToString(make([]byte, 11)), "validation_failed"},
		{"iv 13 bytes", "iv", base64.StdEncoding.EncodeToString(make([]byte, 13)), "validation_failed"},
		{"iv padding bits", "iv", "AAAAAAAAAAAAAAB=", "validation_failed"},
		{"iv long string", "iv", strings.Repeat("A", maxEncryptionIVBytes+1), "validation_failed"},
		{"iv large array", "iv", make([]int, 40000), "validation_failed"},
		{"epoch zero", "keyEpoch", 0, "validation_failed"},
		{"epoch negative", "keyEpoch", -1, "validation_failed"},
		{"epoch fractional", "keyEpoch", 1.5, "validation_failed"},
		{"epoch string", "keyEpoch", "1", "validation_failed"},
		{"epoch above safe maximum", "keyEpoch", int64(maxJSONSafeInteger) + 1, "validation_failed"},
		{"size string", "sizeBytes", "15", "invalid_size"},
		{"size negative", "sizeBytes", -1, "invalid_size"},
		{"size fractional", "sizeBytes", 1.5, "invalid_size"},
		{"size unsafe boundary", "sizeBytes", int64(1 << 53), "invalid_size"},
		{"size unsafe", "sizeBytes", int64(1<<53) + 1, "invalid_size"},
		{"invalid ciphertext", "ciphertext", "!!!", "invalid_ciphertext"},
		{"truncated ciphertext", "ciphertext", "YQ=", "invalid_ciphertext"},
		{"mime long", "mimeType", strings.Repeat("x", maxUploadMIMETypeBytes+1), "validation_failed"},
		{"filename long", "fileName", strings.Repeat("x", maxFilenameBytes+1), "validation_failed"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			file := validEncryptedFile()
			file[tt.field] = tt.value
			assertEnvelopeRejected(t, file, tt.code)
		})
	}
}

type savedEnvelopeArgument struct{ value string }

func (a *savedEnvelopeArgument) Match(value driver.Value) bool {
	var ok bool
	a.value, ok = value.(string)
	return ok
}

func testEnvelopeRoundTrip(t *testing.T, file map[string]any, fallback, wantName, wantMIME string) {
	t.Helper()
	ciphertext, err := base64.StdEncoding.DecodeString(file["ciphertext"].(string))
	if err != nil {
		t.Fatal(err)
	}
	handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
	saved := &savedEnvelopeArgument{}
	mock.ExpectQuery("INSERT INTO media\\.uploads").
		WithArgs("user-id", "uploads", sqlmock.AnyArg(), wantName, wantMIME, len(ciphertext), true, saved, "message").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uploader_id", "filename", "content_type", "size_bytes", "created_at"}).
			AddRow(testUploadID, "user-id", wantName, wantMIME, len(ciphertext), "2026-01-01"))
	upload := performUpload(t, handler, envelopeRequest(t, file, fallback))
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if store.putCalls != 1 || store.lastPutSize != int64(len(ciphertext)) || upload["encryption"] != saved.value || upload["encrypted"] != true || upload["success"] != true {
		t.Fatalf("upload=%v Store.Put=%d size=%d saved=%s", upload, store.putCalls, store.lastPutSize, saved.value)
	}
	want := map[string]any{}
	for _, key := range []string{"encrypted", "version", "algorithm", "iv", "keyEpoch", "sizeBytes"} {
		want[key] = file[key]
	}
	want["mimeType"], want["fileName"] = wantMIME, wantName
	wantJSON, _ := json.Marshal(want)
	var normalizedWant, persisted map[string]any
	_ = json.Unmarshal(wantJSON, &normalizedWant)
	if err := json.Unmarshal([]byte(saved.value), &persisted); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(persisted, normalizedWant) || upload["sizeBytes"] != normalizedWant["sizeBytes"] || upload["fileName"] != wantName || upload["contentType"] != wantMIME {
		t.Fatalf("persisted=%v upload=%v, want envelope=%v", persisted, upload, normalizedWant)
	}
	downloadStore := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, string(ciphertext)), nil
	}}
	download, downloadMock := newDownloadHandler(t, downloadStore, wantMIME, int64(len(ciphertext)), true, saved.value)
	response := serveDownload(t, download, http.MethodGet, nil)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	normalizedWant["ciphertext"] = base64.StdEncoding.EncodeToString(ciphertext)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/json" || !reflect.DeepEqual(body, normalizedWant) {
		t.Fatalf("download status=%d body=%v, want %v", response.Code, body, normalizedWant)
	}
	if err := downloadMock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEncryptedEnvelopeV2RoundTrip(t *testing.T) {
	for _, tt := range []struct{ epoch, size int64 }{{1, 0}, {5, 999}, {5, maxJSONSafeInteger}, {maxJSONSafeInteger, 999}} {
		file := validEncryptedFile()
		file["keyEpoch"], file["sizeBytes"] = tt.epoch, tt.size
		testEnvelopeRoundTrip(t, file, "", "file.bin", "text/html")
	}
}

func TestEncryptedUploadOutsidePlainMIMEPolicy(t *testing.T) {
	for _, mimeType := range []string{"text/html", "image/svg+xml", "application/octet-stream", "application/x-unknown"} {
		t.Run(mimeType, func(t *testing.T) {
			file := validEncryptedFile()
			file["mimeType"] = mimeType
			testEnvelopeRoundTrip(t, file, "", "file.bin", mimeType)
		})
	}
}

func TestEncryptedEnvelopeDefaultsAndUnknownFields(t *testing.T) {
	for _, fallback := range []string{"", "../fallback.bin"} {
		file := validEncryptedFile()
		delete(file, "mimeType")
		delete(file, "fileName")
		file["futureField"] = map[string]any{"ignored": true}
		testEnvelopeRoundTrip(t, file, fallback, sanitizeFilename(fallback), "application/octet-stream")
		file["mimeType"], file["fileName"] = "", ""
		testEnvelopeRoundTrip(t, file, fallback, sanitizeFilename(fallback), "application/octet-stream")
	}
	file := validEncryptedFile()
	file["fileName"] = `C:\private\file.bin`
	testEnvelopeRoundTrip(t, file, "ignored.bin", "file.bin", "text/html")
}

func TestEncryptedCiphertextDecoderRemainsNonStrict(t *testing.T) {
	for _, encoded := range []string{"YR==", "YQ==\r\n", ""} {
		file := validEncryptedFile()
		file["ciphertext"] = encoded
		testEnvelopeRoundTrip(t, file, "", "file.bin", "text/html")
	}
}

func TestLegacyEncryptedDownloadWithoutPlaintextSize(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, "cipher"), nil
	}}
	handler, mock := newDownloadHandler(t, store, "text/html", 6, true, `{"version":1}`)
	response := serveDownload(t, handler, http.MethodGet, nil)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || body["sizeBytes"] != float64(6) || body["version"] != float64(1) || body["keyEpoch"] != nil {
		t.Fatalf("legacy download changed: status=%d body=%v", response.Code, body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

type failedEncryptedStore struct{ *testStore }

func (s failedEncryptedStore) Put(context.Context, string, string, io.Reader, int64, string) error {
	s.putCalls++
	return errors.New("storage unavailable")
}

func TestEncryptedUploadPersistenceFailuresRemain500(t *testing.T) {
	for _, failure := range []string{"storage", "database"} {
		t.Run(failure, func(t *testing.T) {
			handler, mock, store := newMediaTestHandler(t, defaultTestMaxUploadBytes)
			if failure == "storage" {
				handler.service.store = failedEncryptedStore{store}
			} else {
				mock.ExpectQuery("INSERT INTO media\\.uploads").WillReturnError(errors.New("database unavailable"))
			}
			response := executeUpload(handler, envelopeRequest(t, validEncryptedFile(), ""))
			if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"upload_failed"`) || store.putCalls != 1 {
				t.Fatalf("status=%d body=%s Store.Put=%d", response.Code, response.Body.String(), store.putCalls)
			}
			if failure == "database" && store.deleteCalls != 1 {
				t.Fatal("DB failure must still compensate the stored object")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
