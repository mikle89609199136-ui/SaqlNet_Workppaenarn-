//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/textproto"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	openapi "craneapp/backend-v2/contracts/openapi"
	"craneapp/backend-v2/internal/media"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/platform/mediarefs"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// JWT signing is outside this suite; cookie extraction, ACL, DB, HTTP proxy
// and SigV4 object-storage requests all use the production code.
type mediaStorageAuth struct{}

func (mediaStorageAuth) VerifyToken(_ context.Context, token string) (cryptoclient.TokenClaims, error) {
	return cryptoclient.TokenClaims{Subject: token, Expires: time.Now().Add(time.Hour).Unix()}, nil
}
func (mediaStorageAuth) IsTokenRevoked(context.Context, string, cryptoclient.TokenClaims) (bool, error) {
	return false, nil
}

func TestMediaStorageContract(t *testing.T) {
	t.Setenv("CRANE_ENV", "development")
	t.Setenv("ALLOWED_ORIGINS", "https://client.example")
	ctx := context.Background()
	db := dbtest.Postgres(t)
	const owner = "aaaaaaaa-0718-4718-8718-111111111111"
	dbtest.User(t, db, owner, "storage_owner")
	const stranger = "bbbbbbbb-0718-4718-8718-222222222222"
	dbtest.User(t, db, stranger, "storage_stranger")
	minioRequest := testcontainers.ContainerRequest{
		Env: map[string]string{"MINIO_ROOT_USER": "media-test", "MINIO_ROOT_PASSWORD": "media-test-local-only"},
		Cmd: []string{"server", "/data"}, ExposedPorts: []string{"9000/tcp"},
		WaitingFor: wait.ForHTTP("/minio/health/ready").WithPort("9000/tcp").WithStartupTimeout(time.Minute),
	}
	if image := os.Getenv("MINIO_TEST_IMAGE"); image != "" {
		// CI loads a cached image before testing. Its content-hashed tag also
		// invalidates Go's test cache when the Dockerfile changes.
		minioRequest.Image = image
	} else {
		// Local runs keep building the same MinIO release as Dockerfile.prod;
		// no public prebuilt image is required.
		minioRequest.FromDockerfile = testcontainers.FromDockerfile{
			Context: "testdata", Dockerfile: "minio.Dockerfile",
			Repo: "craneapp-media-minio-test", Tag: "2025-10-15", KeepImage: true,
		}
	}
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: minioRequest, Started: true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, container.Terminate(ctx)) })
	host, err := container.Host(ctx)
	require.NoError(t, err)
	port, err := container.MappedPort(ctx, "9000/tcp")
	require.NoError(t, err)
	storageURL := "http://" + host + ":" + port.Port()
	store := media.NewMinioStore(storageURL, "media-test", "media-test-local-only", "us-east-1")
	const bucket = "media-contract"
	require.NoError(t, store.EnsureBucket(ctx, bucket))
	var policy struct {
		MaxFileSizeBytes int64    `json:"maxFileSizeBytes"`
		PlainMimeTypes   []string `json:"plainMimeTypes"`
	}
	policyJSON, err := os.ReadFile("../../contracts/openapi/media-policy.json")
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(policyJSON, &policy))
	handler := media.NewHandler(media.NewService(db, store, bucket, policy.MaxFileSizeBytes))
	authenticated := authctx.Middleware(mediaStorageAuth{}, mediaStorageAuth{})
	mediaMux := http.NewServeMux()
	mediaMux.Handle("/api/v2/media", authenticated(http.HandlerFunc(handler.Upload)))
	mediaMux.Handle("/api/v2/media/", authenticated(http.HandlerFunc(handler.Serve)))
	upstream := httptest.NewServer(httpx.Middleware(mediaMux))
	t.Cleanup(upstream.Close)
	upstreamURL, err := url.Parse(upstream.URL)
	require.NoError(t, err)
	edgeMux := http.NewServeMux()
	registerMediaRoutes(edgeMux, httputil.NewSingleHostReverseProxy(upstreamURL))
	edgeMux.Handle("/docs/media-policy.json", openapi.Files())
	edge := httptest.NewServer(httpx.Middleware(originGuard(edgeMux)))
	t.Cleanup(edge.Close)
	client := &http.Client{Timeout: 2 * time.Minute}

	request := func(t *testing.T, method, path, user, contentType string, body io.Reader, headers http.Header) (*http.Response, []byte) {
		t.Helper()
		req, err := http.NewRequest(method, edge.URL+path, body)
		require.NoError(t, err)
		req.Header.Set("Origin", "https://client.example")
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		if user != "" {
			req.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: user})
		}
		for name, values := range headers {
			req.Header[name] = values
		}
		response, err := client.Do(req)
		require.NoError(t, err)
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		require.NoError(t, err)
		return response, data
	}
	upload := func(t *testing.T, name, mediaType string, data []byte, multipartBody bool) string {
		t.Helper()
		var payload bytes.Buffer
		contentType := "application/json"
		if multipartBody {
			writer := multipart.NewWriter(&payload)
			header := textproto.MIMEHeader{}
			header.Set("Content-Disposition", `form-data; name="file"; filename="`+name+`"`)
			header.Set("Content-Type", mediaType)
			part, err := writer.CreatePart(header)
			require.NoError(t, err)
			_, err = part.Write(data)
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			contentType = writer.FormDataContentType()
		} else {
			require.NoError(t, json.NewEncoder(&payload).Encode(map[string]any{
				"fileName": name, "file": "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data),
			}))
		}
		response, body := request(t, http.MethodPost, "/api/v2/media", owner, contentType, &payload, nil)
		require.Equal(t, http.StatusCreated, response.StatusCode, string(body))
		var result struct {
			URL, FileName, ContentType string
			SizeBytes                  int64
		}
		require.NoError(t, json.Unmarshal(body, &result))
		require.Equal(t, name, result.FileName)
		require.Equal(t, int64(len(data)), result.SizeBytes)
		require.Equal(t, mediaType, result.ContentType)
		require.True(t, strings.HasPrefix(result.URL, "/api/v2/media/"))
		return result.URL
	}
	const content = "0123456789abcdef"
	t.Run("published policy", func(t *testing.T) {
		response, data := request(t, http.MethodGet, "/docs/media-policy.json", "", "", nil, nil)
		require.Equal(t, http.StatusOK, response.StatusCode)
		require.JSONEq(t, string(policyJSON), string(data))
	})
	for _, mediaType := range policy.PlainMimeTypes {
		for _, multipartBody := range []bool{false, true} {
			t.Run(mediaType+"/multipart="+strconv.FormatBool(multipartBody), func(t *testing.T) {
				path := upload(t, "отчёт 718.txt", mediaType, []byte(content), multipartBody)
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					for _, ranged := range []bool{false, true} {
						headers := http.Header{}
						status, expected := http.StatusOK, content
						if ranged {
							headers.Set("Range", "bytes=2-5")
							status, expected = http.StatusPartialContent, content[2:6]
						}
						response, data := request(t, method, path, owner, "", nil, headers)
						require.Equal(t, status, response.StatusCode)
						require.Equal(t, strconv.Itoa(len(expected)), response.Header.Get("Content-Length"))
						require.Equal(t, mediaType, response.Header.Get("Content-Type"))
						require.Empty(t, response.Header.Get("Content-Disposition"))
						require.Equal(t, "bytes", response.Header.Get("Accept-Ranges"))
						require.Equal(t, "nosniff", response.Header.Get("X-Content-Type-Options"))
						require.Equal(t, "private, no-cache", response.Header.Get("Cache-Control"))
						require.Equal(t, "https://client.example", response.Header.Get("Access-Control-Allow-Origin"))
						require.Equal(t, "true", response.Header.Get("Access-Control-Allow-Credentials"))
						for _, vary := range []string{"Origin", "Cookie", "Authorization"} {
							require.Contains(t, strings.Join(response.Header.Values("Vary"), ","), vary)
						}
						if ranged {
							require.Equal(t, "bytes 2-5/16", response.Header.Get("Content-Range"))
						}
						if method == http.MethodHead {
							require.Empty(t, data)
						} else {
							require.Equal(t, expected, string(data))
						}
					}
				}
			})
		}
	}
	path := upload(t, "test.txt", "text/plain", []byte(content), false)
	t.Run("storage bucket is private", func(t *testing.T) {
		var key string
		require.NoError(t, db.QueryRow(`SELECT object_key FROM media.uploads WHERE id = $1`, strings.TrimPrefix(path, "/api/v2/media/")).Scan(&key))
		response, err := client.Get(storageURL + "/" + bucket + "/" + key)
		require.NoError(t, err)
		require.NoError(t, response.Body.Close())
		require.Equal(t, http.StatusForbidden, response.StatusCode)
	})
	t.Run("conditional requests always recheck ACL and return the full representation", func(t *testing.T) {
		for _, user := range []string{owner, stranger, ""} {
			response, data := request(t, http.MethodGet, path, user, "", nil, http.Header{
				"If-None-Match": {"*"}, "If-Modified-Since": {time.Now().Add(time.Hour).UTC().Format(http.TimeFormat)},
			})
			status := http.StatusOK
			if user == stranger {
				status = http.StatusForbidden
			} else if user == "" {
				status = http.StatusUnauthorized
			}
			require.Equal(t, status, response.StatusCode)
			require.Empty(t, response.Header.Get("ETag"))
			require.Empty(t, response.Header.Get("Last-Modified"))
			if user == owner {
				require.Equal(t, content, string(data))
			}
		}
	})
	t.Run("unsatisfiable range", func(t *testing.T) {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			response, data := request(t, method, path, owner, "", nil, http.Header{"Range": {"bytes=999-"}})
			require.Equal(t, http.StatusRequestedRangeNotSatisfiable, response.StatusCode)
			require.Empty(t, data)
		}
	})
	t.Run("CORS preflight and untrusted origins", func(t *testing.T) {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			response, _ := request(t, http.MethodOptions, path, "", "", nil, http.Header{
				"Access-Control-Request-Method": {method}, "Access-Control-Request-Headers": {"Range, If-Range"},
			})
			require.Equal(t, http.StatusNoContent, response.StatusCode)
			require.Contains(t, strings.Split(response.Header.Get("Access-Control-Allow-Methods"), ", "), method)
			for _, header := range []string{"Range", "If-Range"} {
				require.Contains(t, strings.Split(response.Header.Get("Access-Control-Allow-Headers"), ", "), header)
			}
		}
		response, _ := request(t, http.MethodGet, path, owner, "", nil, nil)
		for _, header := range []string{"Content-Disposition", "Content-Range", "Accept-Ranges"} {
			require.Contains(t, strings.Split(response.Header.Get("Access-Control-Expose-Headers"), ", "), header)
		}
		response, _ = request(t, http.MethodGet, path, owner, "", nil, http.Header{"Origin": {"https://untrusted.example"}})
		require.Empty(t, response.Header.Get("Access-Control-Allow-Origin"))
		require.Empty(t, response.Header.Get("Access-Control-Allow-Credentials"))
	})
	t.Run("dangerous legacy types download as attachments", func(t *testing.T) {
		for _, mediaType := range []string{"text/html", "image/svg+xml", "application/javascript", "application/x-unknown"} {
			_, err := db.Exec(`UPDATE media.uploads SET content_type = $2 WHERE id = $1`, strings.TrimPrefix(path, "/api/v2/media/"), mediaType)
			require.NoError(t, err)
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				response, _ := request(t, method, path, owner, "", nil, nil)
				require.Equal(t, http.StatusOK, response.StatusCode)
				require.Equal(t, "application/octet-stream", response.Header.Get("Content-Type"))
				require.Equal(t, "attachment", response.Header.Get("Content-Disposition"))
				require.Equal(t, "nosniff", response.Header.Get("X-Content-Type-Options"))
			}
			payload, err := json.Marshal(map[string]string{"file": "data:" + mediaType + ";base64,YQ=="})
			require.NoError(t, err)
			response, data := request(t, http.MethodPost, "/api/v2/media", owner, "application/json", bytes.NewReader(payload), nil)
			require.Equal(t, http.StatusUnsupportedMediaType, response.StatusCode, string(data))
		}
	})
	t.Run("encoded filenames survive object storage", func(t *testing.T) {
		for _, name := range []string{"отчёт.данные", "report.a b", "report.a#b", "report.a?b", "report.a+b%20"} {
			path := upload(t, name, "text/plain", []byte(content), false)
			response, data := request(t, http.MethodGet, path, owner, "", nil, nil)
			require.Equal(t, http.StatusOK, response.StatusCode)
			require.Equal(t, content, string(data))
			var key string
			require.NoError(t, db.QueryRow(`SELECT object_key FROM media.uploads WHERE id = $1`, strings.TrimPrefix(path, "/api/v2/media/")).Scan(&key))
			presigned, err := store.PresignGet(ctx, bucket, key, time.Minute)
			require.NoError(t, err)
			stored, err := client.Get(presigned)
			require.NoError(t, err)
			storedData, err := io.ReadAll(stored.Body)
			require.NoError(t, stored.Body.Close())
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, stored.StatusCode)
			require.Equal(t, content, string(storedData))
			require.NoError(t, store.Delete(ctx, bucket, key))
			response, _ = request(t, http.MethodGet, path, owner, "", nil, nil)
			require.Equal(t, http.StatusNotFound, response.StatusCode)
		}
	})

	t.Run("cleanup and orphan dry-run", func(t *testing.T) {
		path := upload(t, "cleanup.txt", "text/plain", []byte("cleanup content"), false)
		id := strings.TrimPrefix(path, mediarefs.URLPrefix)
		var key string
		require.NoError(t, db.QueryRow(`SELECT object_key FROM media.uploads WHERE id=$1`, id).Scan(&key))
		require.NoError(t, store.Put(ctx, bucket, "historical-orphan", strings.NewReader("orphan"), 6, "text/plain"))
		var inventory bytes.Buffer
		require.NoError(t, media.AuditOrphans(ctx, db, store, bucket, &inventory))
		require.Contains(t, inventory.String(), `"objectKey":"historical-orphan"`)
		require.Contains(t, inventory.String(), `"status":"untracked_candidate"`)
		// Inventory must not mutate either storage or the job queue.
		object, err := store.Get(ctx, bucket, "historical-orphan", media.GetOptions{})
		require.NoError(t, err)
		require.NoError(t, object.Body.Close())
		_, err = db.Exec(`UPDATE media.uploads SET created_at=NOW()-INTERVAL '8 days' WHERE id=$1`, id)
		require.NoError(t, err)
		_, err = db.Exec(`UPDATE media.object_cleanup_jobs SET next_attempt_at=NOW() WHERE bucket=$1 AND object_key=$2`, bucket, key)
		require.NoError(t, err)
		processed, err := media.NewCleanupWorker(db, store).ProcessNext(ctx)
		require.NoError(t, err)
		require.True(t, processed)
		object, err = store.Get(ctx, bucket, key, media.GetOptions{})
		require.NoError(t, err)
		require.NoError(t, object.Body.Close())
		require.Equal(t, http.StatusNotFound, object.StatusCode)
		response, _ := request(t, http.MethodGet, path, owner, "", nil, nil)
		require.Equal(t, http.StatusNotFound, response.StatusCode)
	})

	block, err := aes.NewCipher(make([]byte, 32))
	require.NoError(t, err)
	aead, err := cipher.NewGCM(block)
	require.NoError(t, err)
	uploadEncrypted := func(t *testing.T, plaintext []byte, wantStatus int) string {
		t.Helper()
		nonce := make([]byte, aead.NonceSize()) // Deterministic test key/nonce; never production data.
		ciphertext := aead.Seal(nil, nonce, plaintext, nil)
		payload, err := json.Marshal(map[string]any{"purpose": "message", "file": map[string]any{
			"version": 2, "encrypted": true, "algorithm": "AES-GCM", "keyEpoch": 1,
			"iv": base64.StdEncoding.EncodeToString(nonce), "ciphertext": base64.StdEncoding.EncodeToString(ciphertext),
			"sizeBytes": len(plaintext), "mimeType": "application/zip", "fileName": "архив 718.zip",
		}})
		require.NoError(t, err)
		response, data := request(t, http.MethodPost, "/api/v2/media", owner, "application/json", bytes.NewReader(payload), nil)
		require.Equal(t, wantStatus, response.StatusCode, string(data[:min(len(data), 512)]))
		var result struct {
			URL, Code, FileName string
			SizeBytes           int64
		}
		require.NoError(t, json.Unmarshal(data, &result))
		if wantStatus != http.StatusCreated {
			require.Equal(t, "file_too_large", result.Code)
			return ""
		}
		require.Equal(t, "архив 718.zip", result.FileName)
		require.Equal(t, int64(len(plaintext)), result.SizeBytes)
		response, data = request(t, http.MethodGet, result.URL, owner, "", nil, http.Header{"Range": {"bytes=0-1"}})
		require.Equal(t, http.StatusOK, response.StatusCode)
		require.EqualValues(t, len(data), response.ContentLength)
		require.Equal(t, "application/json", response.Header.Get("Content-Type"))
		var envelope struct {
			IV, Ciphertext, FileName string
			Version, KeyEpoch        int
			SizeBytes                int64
		}
		require.NoError(t, json.Unmarshal(data, &envelope))
		require.Equal(t, "архив 718.zip", envelope.FileName)
		require.Equal(t, 2, envelope.Version)
		require.Equal(t, 1, envelope.KeyEpoch)
		require.Equal(t, int64(len(plaintext)), envelope.SizeBytes)
		downloaded, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
		require.NoError(t, err)
		decrypted, err := aead.Open(nil, nonce, downloaded, nil)
		require.NoError(t, err)
		require.Equal(t, plaintext, decrypted)
		head, body := request(t, http.MethodHead, result.URL, owner, "", nil, nil)
		require.Equal(t, http.StatusOK, head.StatusCode)
		require.Empty(t, body)
		require.Equal(t, response.ContentLength, head.ContentLength)
		return result.URL
	}
	t.Run("encrypted AES-GCM round trip", func(t *testing.T) {
		uploadEncrypted(t, []byte("содержимое файла"), http.StatusCreated)
	})
	t.Run("100 MiB storage boundary", func(t *testing.T) {
		if testing.Short() {
			t.Skip("large object storage payloads")
		}
		t.Run("plain multipart", func(t *testing.T) {
			defer runtime.GC()
			path := upload(t, "large.bin", "text/plain", make([]byte, int(policy.MaxFileSizeBytes)), true)
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				response, data := request(t, method, path, owner, "", nil, http.Header{"Range": {"bytes=104857596-104857599"}})
				require.Equal(t, http.StatusPartialContent, response.StatusCode)
				require.EqualValues(t, 4, response.ContentLength)
				if method == http.MethodGet {
					require.Equal(t, make([]byte, 4), data)
				} else {
					require.Empty(t, data)
				}
			}
		})
		for _, size := range []int64{policy.MaxFileSizeBytes, policy.MaxFileSizeBytes + 1} {
			t.Run(strconv.FormatInt(size, 10), func(t *testing.T) {
				defer runtime.GC()
				status := http.StatusCreated
				if size > policy.MaxFileSizeBytes {
					status = http.StatusRequestEntityTooLarge
				}
				uploadEncrypted(t, make([]byte, int(size)), status)
			})
		}
	})
}
