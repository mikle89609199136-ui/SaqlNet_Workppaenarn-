package media

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const fakeBlobToken = "vercel_blob_rw_TestStore_testSecret123"

type blobTransport func(*http.Request) (*http.Response, error)

func (f blobTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func blobResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body))}
}
func testBlob(t *testing.T, f blobTransport) *VercelBlobAdapter {
	t.Helper()
	b, e := NewVercelBlobAdapter(fakeBlobToken, 1024)
	if e != nil {
		t.Fatal(e)
	}
	b.client = &http.Client{Transport: f}
	return b
}

type observedBlobReader struct {
	io.Reader
	read bool
}

func (r *observedBlobReader) Read(p []byte) (int, error) { r.read = true; return r.Reader.Read(p) }
func TestBlobPutPrivateStreaming(t *testing.T) {
	r := &observedBlobReader{Reader: strings.NewReader("hello")}
	b := testBlob(t, func(req *http.Request) (*http.Response, error) {
		if r.read {
			t.Fatal("read before transport")
		}
		if req.Method != "PUT" || req.URL.Query().Get("pathname") != "bucket/user/file.txt" {
			t.Fatal("wrong object")
		}
		for k, v := range map[string]string{"Authorization": "Bearer " + fakeBlobToken, "X-Vercel-Blob-Access": "private", "X-Allow-Overwrite": "0", "X-Add-Random-Suffix": "0", "X-Content-Type": "text/plain", "X-Api-Version": "13", "X-Content-Length": "5"} {
			if req.Header.Get(k) != v {
				t.Errorf("header %s", k)
			}
		}
		data, e := io.ReadAll(req.Body)
		if e != nil || string(data) != "hello" || req.ContentLength != 5 {
			t.Fatal("wrong body")
		}
		return blobResponse(200, `{"pathname":"bucket/user/file.txt","url":"https://teststore.private.blob.vercel-storage.com/bucket/user/file.txt"}`), nil
	})
	if e := b.Put(context.Background(), "bucket", "user/file.txt", r, 5, "text/plain"); e != nil {
		t.Fatal(e)
	}
}
func TestBlobGetMetadata(t *testing.T) {
	for _, head := range []bool{false, true} {
		b := testBlob(t, func(req *http.Request) (*http.Response, error) {
			method := "GET"
			if head {
				method = "HEAD"
			}
			if req.Method != method || req.Header.Get("Range") != "bytes=1-3" || req.Header.Get("Authorization") != "Bearer "+fakeBlobToken {
				t.Fatal("wrong download")
			}
			r := blobResponse(206, "ell")
			r.Header.Set("Content-Type", "text/plain")
			r.Header.Set("Content-Range", "bytes 1-3/5")
			r.Header.Set("Accept-Ranges", "bytes")
			return r, nil
		})
		o, e := b.Get(context.Background(), "bucket", "file", GetOptions{Head: head, Range: "bytes=1-3"})
		if e != nil {
			t.Fatal(e)
		}
		o.Body.Close()
		if o.StatusCode != 206 || o.ContentLength != 3 || o.ContentType != "text/plain" || o.ContentRange != "bytes 1-3/5" || o.AcceptRanges != "bytes" {
			t.Fatal("metadata lost")
		}
	}
}
func TestBlobDelete(t *testing.T) {
	for _, status := range []int{200, 204, 404} {
		b := testBlob(t, func(req *http.Request) (*http.Response, error) {
			if req.Method != "POST" || req.URL.Path != "/api/blob/delete" {
				t.Fatal("wrong delete endpoint")
			}
			var v struct {
				URLs []string `json:"urls"`
			}
			if e := json.NewDecoder(req.Body).Decode(&v); e != nil {
				t.Fatal(e)
			}
			if len(v.URLs) != 1 || v.URLs[0] != "bucket/user/file" {
				t.Fatal("wrong delete key")
			}
			return blobResponse(status, ""), nil
		})
		if e := b.Delete(context.Background(), "bucket", "user/file"); e != nil {
			t.Fatal(e)
		}
	}
}
func TestBlobAPIErrors(t *testing.T) {
	for _, status := range []int{401, 403, 404, 409, 413, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			b := testBlob(t, func(*http.Request) (*http.Response, error) { calls++; return blobResponse(status, fakeBlobToken), nil })
			e := b.Put(context.Background(), "bucket", "file", strings.NewReader("x"), 1, "text/plain")
			if e == nil || strings.Contains(e.Error(), fakeBlobToken) || calls != 1 {
				t.Fatal("error leak/retry")
			}
			if status == 413 && !errors.Is(e, ErrTooBig) {
				t.Fatal("size mapping")
			}
			if status != 413 && !errors.Is(e, ErrStorage) {
				t.Fatal("storage mapping")
			}
			o, e := b.Get(context.Background(), "bucket", "file", GetOptions{})
			if e != nil {
				t.Fatal(e)
			}
			o.Body.Close()
			if o.StatusCode != status {
				t.Fatal("status lost")
			}
		})
	}
}
func TestBlobCancellationLimitsAndRedaction(t *testing.T) {
	b := testBlob(t, func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e := b.Put(ctx, "bucket", "file", strings.NewReader("x"), 1, "text/plain"); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if _, e := b.Get(ctx, "bucket", "file", GetOptions{}); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if e := b.Delete(ctx, "bucket", "file"); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if e := b.Put(context.Background(), "bucket", "file", strings.NewReader("x"), 1025, "text/plain"); !errors.Is(e, ErrTooBig) {
		t.Fatal("missing limit")
	}
	b = testBlob(t, func(*http.Request) (*http.Response, error) { return nil, errors.New(fakeBlobToken) })
	if e := b.Delete(context.Background(), "bucket", "file"); e == nil || strings.Contains(e.Error(), fakeBlobToken) {
		t.Fatal("leaked transport error")
	}
}
func TestBlobKeySafetyAndPrivateReference(t *testing.T) {
	b := testBlob(t, func(*http.Request) (*http.Response, error) { t.Fatal("unsafe key reached network"); return nil, nil })
	for _, key := range []string{"../other", "/other", "user/../other", "user//file", "user\\file", "file\n"} {
		if e := b.Delete(context.Background(), "bucket", key); e == nil {
			t.Fatalf("accepted %q", key)
		}
	}
	u, e := b.PresignGet(context.Background(), "bucket", "user/file name", time.Hour)
	if e != nil || !strings.Contains(u, ".private.blob.") || strings.Contains(u, fakeBlobToken) || !strings.HasSuffix(u, "file%20name") {
		t.Fatal("unsafe reference")
	}
	for _, body := range []string{`{"pathname":"bucket/file","url":"https://teststore.public.blob.vercel-storage.com/bucket/file"}`, `{"pathname":"bucket/other","url":"https://teststore.private.blob.vercel-storage.com/bucket/other"}`} {
		b = testBlob(t, func(*http.Request) (*http.Response, error) { return blobResponse(200, body), nil })
		if e := b.Put(context.Background(), "bucket", "file", strings.NewReader("x"), 1, "text/plain"); e == nil {
			t.Fatal("public/mismatched object accepted")
		}
	}
}
func TestBlobRedirectDoesNotLeakToken(t *testing.T) {
	leaked := false
	dst := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer dst.Close()
	src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, dst.URL, 307) }))
	defer src.Close()
	b, _ := NewVercelBlobAdapter(fakeBlobToken, 1024)
	b.apiURL = src.URL
	if e := b.Delete(context.Background(), "bucket", "file"); e == nil {
		t.Fatal("redirect accepted")
	}
	if leaked {
		t.Fatal("redirect followed")
	}
}
func TestConfiguredStorage(t *testing.T) {
	for _, tc := range []struct {
		name      string
		env       map[string]string
		blob, bad bool
	}{
		{"defaults", map[string]string{}, false, false},
		{"minio", map[string]string{"STORAGE_PROVIDER": "minio"}, false, false},
		{"blob", map[string]string{"STORAGE_PROVIDER": "vercel_blob", "BLOB_READ_WRITE_TOKEN": fakeBlobToken}, true, false},
		{"no token", map[string]string{"STORAGE_PROVIDER": "vercel_blob"}, false, true},
		{"invalid token", map[string]string{"STORAGE_PROVIDER": "vercel_blob", "BLOB_READ_WRITE_TOKEN": "hidden"}, false, true},
		{"unknown", map[string]string{"STORAGE_PROVIDER": "other"}, false, true},
		{"invalid namespace", map[string]string{"STORAGE_PROVIDER": "vercel_blob", "BLOB_READ_WRITE_TOKEN": fakeBlobToken, "MEDIA_BUCKET": "../bad"}, false, true},
		{"production minio default", map[string]string{"CRANE_ENV": "production"}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, e := NewConfiguredStore(func(k string) string { return tc.env[k] }, 1024)
			if (e != nil) != tc.bad {
				t.Fatal(e)
			}
			if e != nil {
				return
			}
			_, blob := s.(*VercelBlobAdapter)
			if blob != tc.blob {
				t.Fatal("wrong provider")
			}
		})
	}
}
func TestBlobDownloadHandlerContract(t *testing.T) {
	for _, status := range []int{200, 206, 404, 403, 429} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			b := testBlob(t, func(*http.Request) (*http.Response, error) {
				r := blobResponse(status, "hello")
				r.Header.Set("Content-Type", "text/plain")
				r.Header.Set("Accept-Ranges", "bytes")
				if status == 206 {
					r.Header.Set("Content-Range", "bytes 0-4/10")
				}
				return r, nil
			})
			h, m := newDownloadHandler(t, b, "text/plain", 5, false, nil)
			req := httptest.NewRequest("GET", "/api/v2/media/"+testUploadID, nil)
			if status == 206 {
				req.Header.Set("Range", "bytes=0-4")
			}
			out := httptest.NewRecorder()
			h.Serve(out, req)
			want := status
			if status == 403 || status == 429 {
				want = 502
			}
			if out.Code != want {
				t.Fatalf("got %d want %d: %s", out.Code, want, out.Body.String())
			}
			if status == 200 || status == 206 {
				if out.Body.String() != "hello" || out.Header().Get("Content-Type") != "text/plain" || !strings.HasPrefix(out.Header().Get("Cache-Control"), "private") {
					t.Fatal("contract changed")
				}
			}
			if strings.Contains(out.Body.String(), fakeBlobToken) {
				t.Fatal("token leak")
			}
			if e := m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestBlobUploadHandlerContract(t *testing.T) {
	h, m, _ := newMediaTestHandler(t, 1024)
	h.service.store = testBlob(t, func(req *http.Request) (*http.Response, error) {
		p := req.URL.Query().Get("pathname")
		data, e := io.ReadAll(req.Body)
		if e != nil || string(data) != "hello" {
			t.Fatal("body changed")
		}
		raw, _ := json.Marshal(map[string]string{"pathname": p, "url": "https://teststore.private.blob.vercel-storage.com/" + p})
		return blobResponse(200, string(raw)), nil
	})
	expectUploadInsert(m, "file.txt", "text/plain", 5)
	out := executeUpload(h, multipartUploadRequest(t, "file.txt", "text/plain", []byte("hello")))
	if out.Code != 201 {
		t.Fatalf("%d: %s", out.Code, out.Body.String())
	}
	var v map[string]any
	json.Unmarshal(out.Body.Bytes(), &v)
	if v["url"] != "/api/v2/media/upload-id" || v["success"] != true || v["fileName"] != "file.txt" || strings.Contains(out.Body.String(), "vercel-storage") {
		t.Fatal("upload contract changed")
	}
	if e := m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
