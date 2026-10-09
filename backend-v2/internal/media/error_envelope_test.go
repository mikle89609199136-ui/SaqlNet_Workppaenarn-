package media

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFileTooLargeResponseContract(t *testing.T) {
	const limit int64 = 8
	tests := []struct {
		name             string
		request          func(*testing.T, *Handler) *http.Request
		exceedsBodyLimit bool
	}{
		{
			name: "JSON body exceeds MaxBytesReader limit",
			request: func(t *testing.T, handler *Handler) *http.Request {
				body := `{"file":"data:text/plain;base64,YQ=="}` + strings.Repeat(" ", int(handler.jsonBodyLimit()))
				request := httptest.NewRequest(http.MethodPost, "/api/v2/media", strings.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				return request
			},
			exceedsBodyLimit: true,
		},
		{
			name: "encrypted ciphertext exceeds upload limit",
			request: func(t *testing.T, _ *Handler) *http.Request {
				return encryptedUploadRequest(t, "large.bin", "application/octet-stream", bytes.Repeat([]byte{'a'}, int(limit+1)))
			},
		},
		{
			name: "data URL exceeds upload limit",
			request: func(t *testing.T, _ *Handler) *http.Request {
				return dataURLUploadRequest(t, "large.txt", "text/plain", bytes.Repeat([]byte{'a'}, int(limit+1)))
			},
		},
		{
			name: "multipart body exceeds MaxBytesReader limit",
			request: func(t *testing.T, handler *Handler) *http.Request {
				return multipartUploadRequest(t, "large.pdf", "application/pdf", bytes.Repeat([]byte{'a'}, int(handler.multipartBodyLimit()+1)))
			},
			exceedsBodyLimit: true,
		},
		{
			name: "multipart file exceeds upload limit within body limit",
			request: func(t *testing.T, _ *Handler) *http.Request {
				return multipartUploadRequest(t, "large.pdf", "application/pdf", bytes.Repeat([]byte{'a'}, int(limit+1)))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock, store := newMediaTestHandler(t, limit)
			request := tt.request(t, handler)
			bodyLimit := handler.jsonBodyLimit()
			if strings.HasPrefix(request.Header.Get("Content-Type"), "multipart/") {
				bodyLimit = handler.multipartBodyLimit()
			}
			if exceeds := request.ContentLength > bodyLimit; exceeds != tt.exceedsBodyLimit {
				t.Fatalf("body size=%d limit=%d, want exceedsBodyLimit=%t", request.ContentLength, bodyLimit, tt.exceedsBodyLimit)
			}
			request.Header.Set("X-Request-ID", "contract-413-"+tt.name)
			response := executeUpload(handler, request)
			assertFileTooLargeResponse(t, response, limit)
			assertUploadErrorContract(t, response, map[string]string{
				"code":      "file_too_large",
				"message":   uploadLimitMessage(limit),
				"requestId": request.Header.Get("X-Request-ID"),
			})
			if store.putCalls != 0 {
				t.Errorf("Store.Put calls=%d, want 0", store.putCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func assertUploadErrorContract(t *testing.T, response *httptest.ResponseRecorder, want map[string]string) map[string]json.RawMessage {
	t.Helper()
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type=%q, want application/json", got)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["error"]; exists {
		t.Fatal("unexpected nested error envelope")
	}
	if len(fields) != len(want) {
		t.Fatalf("unexpected top-level keys: %s", response.Body.String())
	}
	for key, wantValue := range want {
		var got string
		if err := json.Unmarshal(fields[key], &got); err != nil {
			t.Fatalf("field %q: %v", key, err)
		}
		if got != wantValue {
			t.Errorf("%s=%q, want %q", key, got, wantValue)
		}
	}
	return fields
}

func TestFileTooLargeEnvelopeMatchesUnsupportedType(t *testing.T) {
	const limit int64 = 8
	handler, mock, store := newMediaTestHandler(t, limit)
	largeRequest := dataURLUploadRequest(t, "large.txt", "text/plain", bytes.Repeat([]byte{'a'}, int(limit+1)))
	badTypeRequest := multipartUploadRequest(t, "bad.bin", "application/octet-stream", []byte("a"))
	largeRequest.Header.Set("X-Request-ID", "contract-413")
	badTypeRequest.Header.Set("X-Request-ID", "contract-415")

	largeResponse := executeUpload(handler, largeRequest)
	assertFileTooLargeResponse(t, largeResponse, limit)
	largeFields := assertUploadErrorContract(t, largeResponse, map[string]string{
		"code":      "file_too_large",
		"message":   uploadLimitMessage(limit),
		"requestId": largeRequest.Header.Get("X-Request-ID"),
	})
	badTypeResponse := executeUpload(handler, badTypeRequest)
	if badTypeResponse.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status=%d body=%s", badTypeResponse.Code, badTypeResponse.Body.String())
	}
	badTypeFields := assertUploadErrorContract(t, badTypeResponse, map[string]string{
		"code":      "unsupported_type",
		"message":   "file type not allowed",
		"requestId": badTypeRequest.Header.Get("X-Request-ID"),
	})
	if len(largeFields) != len(badTypeFields) {
		t.Fatalf("413 keys=%v, 415 keys=%v", largeFields, badTypeFields)
	}
	for key := range largeFields {
		if _, exists := badTypeFields[key]; !exists {
			t.Errorf("413 key %q missing from 415 response", key)
		}
	}
	if store.putCalls != 0 {
		t.Errorf("Store.Put calls=%d, want 0", store.putCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
