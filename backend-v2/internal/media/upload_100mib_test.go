package media

import (
	"bytes"
	"fmt"
	"math"
	"net/http"
	"runtime"
	"testing"
)

// Exercise real wire sizes: the 80 MiB case already exceeds a 100 MiB proxy cap.
func TestEncryptedUpload100MiBBoundaries(t *testing.T) {
	if testing.Short() {
		t.Skip("large media payloads")
	}
	const limit int64 = 100 << 20
	for _, size := range []int64{1 << 20, 70 << 20, 80 << 20, limit - (1<<20)/10, limit, limit + 1} {
		t.Run(fmt.Sprintf("%d_original_bytes", size), func(t *testing.T) {
			// Keep peak memory bounded across the large JSON requests.
			defer runtime.GC()
			handler, mock, store := newMediaTestHandler(t, limit)
			ciphertextSize := size + mediaEncryptionOverheadBytes
			request := encryptedUploadRequest(t, "video.mp4", "video/mp4", bytes.Repeat([]byte{'a'}, int(ciphertextSize)))
			request.Header.Set("X-Request-ID", "upload-100mib")
			if size <= limit {
				expectUploadInsert(mock, "video.mp4", "video/mp4", ciphertextSize)
			}
			response := executeUpload(handler, request)
			if size > limit {
				assertFileTooLargeResponse(t, response, limit)
				assertUploadErrorContract(t, response, map[string]string{
					"code": "file_too_large", "message": "file exceeds 100 MB limit", "requestId": "upload-100mib",
				})
				if store.putCalls != 0 {
					t.Fatal("oversized upload reached storage")
				}
			} else if response.Code != http.StatusCreated || store.lastPutSize != ciphertextSize {
				t.Fatalf("status=%d stored=%d, want status=201 stored=%d", response.Code, store.lastPutSize, ciphertextSize)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEncryptedRequestLimitIncludesTagAndFitsProxy(t *testing.T) {
	const limit int64 = 100 << 20
	handler, _, _ := newMediaTestHandler(t, limit)
	want := base64EncodedSize(limit+16) + jsonRequestOverheadBytes
	if got := handler.jsonBodyLimit(); got != want || got > 140<<20 {
		t.Fatalf("JSON limit=%d, want %d within 140 MiB proxy limit", got, want)
	}
	handler.service.maxUploadBytes = math.MaxInt64
	if got := handler.jsonBodyLimit(); got != math.MaxInt64 {
		t.Fatalf("overflow: JSON limit=%d", got)
	}
}
