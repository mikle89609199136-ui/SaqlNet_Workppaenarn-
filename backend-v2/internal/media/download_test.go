package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const testUploadID = "11111111-1111-1111-1111-111111111111"

type downloadStore struct {
	get          func(context.Context, string, string, GetOptions) (*ObjectResponse, error)
	getCalls     int
	presignCalls int
	options      GetOptions
}

func (s *downloadStore) Put(context.Context, string, string, io.Reader, int64, string) error {
	return nil
}

func (s *downloadStore) Get(ctx context.Context, bucket, key string, options GetOptions) (*ObjectResponse, error) {
	s.getCalls++
	s.options = options
	return s.get(ctx, bucket, key, options)
}

func (s *downloadStore) PresignGet(context.Context, string, string, time.Duration) (string, error) {
	s.presignCalls++
	return "http://minio:9000/crane-media/internal", nil
}

func (s *downloadStore) Delete(context.Context, string, string) error { return nil }

func newDownloadHandler(t *testing.T, store Store, contentType string, size int64, encrypted bool, encryptionJSON any) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mock.ExpectQuery("SELECT uploader_id::text, first_attached_at").WithArgs(testUploadID).
		WillReturnRows(sqlmock.NewRows([]string{"uploader_id", "first_attached_at"}).AddRow("user-id", nil))
	mock.ExpectQuery("SELECT COALESCE\\(bool_or").WithArgs(testUploadID, "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"live", "allowed"}).AddRow(false, false))
	mock.ExpectQuery("SELECT bucket, object_key, content_type, size_bytes, is_encrypted, encryption_key_id").
		WithArgs(testUploadID).
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key", "content_type", "size_bytes", "is_encrypted", "encryption_key_id"}).
			AddRow("crane-media", "user/object", contentType, size, encrypted, encryptionJSON))
	service := NewService(db, store, "crane-media", defaultTestMaxUploadBytes)
	return NewHandler(service), mock
}

func objectResponse(status int, body string) *ObjectResponse {
	return &ObjectResponse{
		Body:          io.NopCloser(strings.NewReader(body)),
		StatusCode:    status,
		ContentLength: int64(len(body)),
	}
}

func serveDownload(t *testing.T, handler *Handler, method string, headers http.Header) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/api/v2/media/"+testUploadID, nil)
	for name, values := range headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	w := httptest.NewRecorder()
	handler.Serve(w, uploadRequestWithUser(req))
	return w
}

func TestDownloadStreamsObjectWithoutRedirect(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, "stored bytes"), nil
	}}
	handler, mock := newDownloadHandler(t, store, "image/jpeg", 12, false, nil)

	w := serveDownload(t, handler, http.MethodGet, nil)

	if w.Code != http.StatusOK || w.Body.String() != "stored bytes" {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Location"); got != "" {
		t.Fatalf("unexpected redirect Location: %q", got)
	}
	if strings.Contains(w.Header().Get("Location")+w.Body.String(), "minio:9000") {
		t.Fatal("internal MinIO hostname leaked to client")
	}
	if got := w.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("Content-Type=%q", got)
	}
	if got := w.Header().Get("Content-Length"); got != "12" {
		t.Fatalf("Content-Length=%q", got)
	}
	if got := w.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges=%q", got)
	}
	if store.presignCalls != 0 {
		t.Fatalf("PresignGet called %d times", store.presignCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadDoesNotIntroduceContentDisposition(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, "pdf"), nil
	}}
	handler, _ := newDownloadHandler(t, store, "application/pdf", 3, false, nil)

	w := serveDownload(t, handler, http.MethodGet, nil)

	if got := w.Header().Get("Content-Disposition"); got != "" {
		t.Fatalf("unexpected Content-Disposition=%q", got)
	}
}

func TestDownloadForwardsRangeAndPartialResponse(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		response := objectResponse(http.StatusPartialContent, "cde")
		response.ContentRange = "bytes 2-4/6"
		response.AcceptRanges = "bytes"
		return response, nil
	}}
	handler, _ := newDownloadHandler(t, store, "video/mp4", 6, false, nil)

	w := serveDownload(t, handler, http.MethodGet, http.Header{"Range": []string{"bytes=2-4"}})

	if store.options.Range != "bytes=2-4" {
		t.Fatalf("Range forwarded as %q", store.options.Range)
	}
	if w.Code != http.StatusPartialContent || w.Body.String() != "cde" {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Range"); got != "bytes 2-4/6" {
		t.Fatalf("Content-Range=%q", got)
	}
	if got := w.Header().Get("Content-Length"); got != "3" {
		t.Fatalf("Content-Length=%q", got)
	}
}

func TestDownloadForwardsUnsatisfiableRangeWithoutStorageBody(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		response := objectResponse(http.StatusRequestedRangeNotSatisfiable, "internal MinIO error")
		response.ContentRange = "bytes */6"
		response.AcceptRanges = "bytes"
		return response, nil
	}}
	handler, _ := newDownloadHandler(t, store, "video/mp4", 6, false, nil)

	w := serveDownload(t, handler, http.MethodGet, http.Header{"Range": []string{"bytes=99-100"}})

	if w.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("storage error body leaked: %q", w.Body.String())
	}
	if got := w.Header().Get("Content-Range"); got != "bytes */6" {
		t.Fatalf("Content-Range=%q", got)
	}
}

func TestDownloadSupportsHead(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, "must not be copied"), nil
	}}
	handler, _ := newDownloadHandler(t, store, "audio/mpeg", 128, false, nil)

	w := serveDownload(t, handler, http.MethodHead, nil)

	if !store.options.Head {
		t.Fatal("HEAD option was not forwarded to storage")
	}
	if w.Code != http.StatusOK || w.Body.Len() != 0 {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Length"); got != "128" {
		t.Fatalf("Content-Length=%q", got)
	}
}

func TestDownloadMissingDatabaseRowIsNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		t.Fatal("storage must not be called")
		return nil, nil
	}}
	mock.ExpectQuery("SELECT uploader_id::text, first_attached_at").
		WithArgs(testUploadID).
		WillReturnRows(sqlmock.NewRows([]string{"uploader_id", "first_attached_at"}))
	mock.ExpectQuery("SELECT EXISTS").WithArgs(testUploadID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	service := NewService(db, store, "crane-media", defaultTestMaxUploadBytes)
	handler := NewHandler(service)

	w := serveDownload(t, handler, http.MethodGet, nil)

	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), `"code":"not_found"`) {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
}

func TestDownloadMissingObjectIsNotFound(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusNotFound, "NoSuchKey from minio:9000"), nil
	}}
	handler, _ := newDownloadHandler(t, store, "image/jpeg", 12, false, nil)

	w := serveDownload(t, handler, http.MethodGet, nil)

	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), `"code":"object_not_found"`) {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "minio:9000") {
		t.Fatalf("storage details leaked: %q", w.Body.String())
	}
}

func TestDownloadStorageErrorDoesNotLeakInfrastructure(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return nil, errors.New("dial http://minio:9000: connection refused")
	}}
	handler, _ := newDownloadHandler(t, store, "image/jpeg", 12, false, nil)

	w := serveDownload(t, handler, http.MethodGet, nil)

	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), `"code":"storage_unavailable"`) {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "minio:9000") {
		t.Fatalf("storage details leaked: %q", w.Body.String())
	}
}

func TestEncryptedDownloadContractIsPreserved(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, "cipher"), nil
	}}
	metadata := `{"version":1,"mimeType":"application/pdf","sizeBytes":42}`
	handler, _ := newDownloadHandler(t, store, "application/pdf", 6, true, metadata)

	w := serveDownload(t, handler, http.MethodGet, http.Header{"Range": []string{"bytes=0-1"}})

	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("status=%d Content-Type=%q body=%q", w.Code, w.Header().Get("Content-Type"), w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["encrypted"] != true || body["ciphertext"] != base64.StdEncoding.EncodeToString([]byte("cipher")) {
		t.Fatalf("unexpected encrypted response: %#v", body)
	}
	if store.options.Range != "" {
		t.Fatalf("encrypted JSON request forwarded Range %q", store.options.Range)
	}
}

type chunkedReadCloser struct {
	data   []byte
	eof    bool
	closed bool
}

func (r *chunkedReadCloser) Read(p []byte) (int, error) {
	if r.closed {
		return 0, errors.New("read after close")
	}
	if len(r.data) == 0 {
		r.eof = true
		return 0, io.EOF
	}
	n := 2
	if len(r.data) < n {
		n = len(r.data)
	}
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func (r *chunkedReadCloser) Close() error {
	r.closed = true
	return nil
}

type streamingRecorder struct {
	header              http.Header
	status              int
	body                bytes.Buffer
	reader              *chunkedReadCloser
	firstWriteBeforeEOF bool
}

func (w *streamingRecorder) Header() http.Header { return w.header }

func (w *streamingRecorder) WriteHeader(status int) { w.status = status }

func (w *streamingRecorder) Write(p []byte) (int, error) {
	if w.body.Len() == 0 {
		w.firstWriteBeforeEOF = !w.reader.eof
	}
	return w.body.Write(p)
}

func TestDownloadWritesBeforeReadingWholeObject(t *testing.T) {
	reader := &chunkedReadCloser{data: []byte("streamed")}
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return &ObjectResponse{Body: reader, StatusCode: http.StatusOK, ContentLength: 8}, nil
	}}
	handler, _ := newDownloadHandler(t, store, "image/jpeg", 8, false, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v2/media/"+testUploadID, nil)
	w := &streamingRecorder{header: make(http.Header), reader: reader}

	handler.Serve(w, uploadRequestWithUser(req))

	if !w.firstWriteBeforeEOF {
		t.Fatal("response body was not written until after the whole object had been read")
	}
	if w.body.String() != "streamed" {
		t.Fatalf("body=%q", w.body.String())
	}
	if !reader.closed {
		t.Fatal("storage body was not closed after streaming completed")
	}
}

type gatedReadCloser struct {
	chunks  [][]byte
	release <-chan struct{}
	index   int
}

func (r *gatedReadCloser) Read(p []byte) (int, error) {
	if r.index >= len(r.chunks) {
		return 0, io.EOF
	}
	if r.index == 1 {
		<-r.release
	}
	chunk := r.chunks[r.index]
	r.index++
	return copy(p, chunk), nil
}

func (r *gatedReadCloser) Close() error { return nil }

type deadlineRecorder struct {
	mu             sync.Mutex
	header         http.Header
	status         int
	body           bytes.Buffer
	deadline       time.Time
	expired        bool
	firstWrite     chan struct{}
	firstWriteOnce sync.Once
}

func newDeadlineRecorder() *deadlineRecorder {
	return &deadlineRecorder{
		header:     make(http.Header),
		firstWrite: make(chan struct{}),
	}
}

func (w *deadlineRecorder) Header() http.Header { return w.header }

func (w *deadlineRecorder) WriteHeader(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.status = status
}

func (w *deadlineRecorder) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.expired && !w.deadline.IsZero() {
		return 0, context.DeadlineExceeded
	}
	n, err := w.body.Write(p)
	w.firstWriteOnce.Do(func() { close(w.firstWrite) })
	return n, err
}

func (w *deadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.deadline = deadline
	return nil
}

func (w *deadlineRecorder) expire() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.expired = true
}

func (w *deadlineRecorder) result() (int, string, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.status, w.body.String(), w.deadline.IsZero()
}

func waitForTestSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for controlled stream")
	}
}

func TestMediaDownloadClearsExpiredWriteDeadline(t *testing.T) {
	release := make(chan struct{})
	body := &gatedReadCloser{
		chunks:  [][]byte{[]byte("first"), []byte("second")},
		release: release,
	}
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return &ObjectResponse{Body: body, StatusCode: http.StatusOK, ContentLength: 11}, nil
	}}
	handler, _ := newDownloadHandler(t, store, "video/mp4", 11, false, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v2/media/"+testUploadID, nil)
	w := newDeadlineRecorder()
	_ = w.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Serve(w, uploadRequestWithUser(req))
	}()

	waitForTestSignal(t, w.firstWrite)
	w.expire()
	close(release)
	waitForTestSignal(t, done)

	status, responseBody, deadlineCleared := w.result()
	if !deadlineCleared {
		t.Fatal("media handler did not clear the write deadline")
	}
	if status != http.StatusOK || responseBody != "firstsecond" {
		t.Fatalf("status=%d body=%q", status, responseBody)
	}
}

func TestMediaHandlerOnlyClearsWriteDeadlineForValidDownloads(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "post with media id", method: http.MethodPost, path: "/api/v2/media/" + testUploadID},
		{name: "nested media route", method: http.MethodGet, path: "/api/v2/media/" + testUploadID + "/metadata"},
		{name: "invalid media id", method: http.MethodGet, path: "/api/v2/media/not-a-uuid"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			w := newDeadlineRecorder()
			_ = w.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))

			NewHandler(nil).Serve(w, httptest.NewRequest(test.method, test.path, nil))

			_, _, deadlineCleared := w.result()
			if deadlineCleared {
				t.Fatal("non-download media request unexpectedly cleared the write deadline")
			}
		})
	}
}

type cancellationReadCloser struct {
	ctx      context.Context
	started  chan struct{}
	canceled chan struct{}
	once     sync.Once
}

func (r *cancellationReadCloser) Read([]byte) (int, error) {
	r.once.Do(func() { close(r.started) })
	<-r.ctx.Done()
	close(r.canceled)
	return 0, r.ctx.Err()
}

func (r *cancellationReadCloser) Close() error { return nil }

func TestMediaDownloadStillPropagatesRequestCancellation(t *testing.T) {
	started := make(chan struct{})
	canceled := make(chan struct{})
	store := &downloadStore{get: func(ctx context.Context, _ string, _ string, _ GetOptions) (*ObjectResponse, error) {
		return &ObjectResponse{
			Body:          &cancellationReadCloser{ctx: ctx, started: started, canceled: canceled},
			StatusCode:    http.StatusOK,
			ContentLength: 1,
		}, nil
	}}
	handler, _ := newDownloadHandler(t, store, "video/mp4", 1, false, nil)
	requestContext, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v2/media/"+testUploadID, nil).WithContext(requestContext)
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Serve(httptest.NewRecorder(), uploadRequestWithUser(req))
	}()

	waitForTestSignal(t, started)
	cancel()
	waitForTestSignal(t, canceled)
	waitForTestSignal(t, done)
}

func TestEncryptedDownloadWritesBeforeReadingWholeObject(t *testing.T) {
	reader := &chunkedReadCloser{
		data: []byte("encrypted-content"),
	}

	store := &downloadStore{
		get: func(
			context.Context,
			string,
			string,
			GetOptions,
		) (*ObjectResponse, error) {
			return &ObjectResponse{
				Body:          reader,
				StatusCode:    http.StatusOK,
				ContentLength: int64(len("encrypted-content")),
			}, nil
		},
	}

	handler, mock := newDownloadHandler(
		t,
		store,
		"application/octet-stream",
		int64(len("encrypted-content")),
		true,
		`{"version":1}`,
	)

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/v2/media/"+testUploadID,
		nil,
	)

	w := &streamingRecorder{
		header: make(http.Header),
		reader: reader,
	}

	handler.Serve(w, uploadRequestWithUser(req))

	if !w.firstWriteBeforeEOF {
		t.Fatal("encrypted response was not written until the whole object had been read")
	}

	if !reader.closed {
		t.Fatal("storage body was not closed")
	}

	var response map[string]any
	if err := json.Unmarshal(w.body.Bytes(), &response); err != nil {
		t.Fatalf("invalid encrypted JSON response: %v; body=%q", err, w.body.String())
	}

	wantCiphertext := base64.StdEncoding.EncodeToString(
		[]byte("encrypted-content"),
	)
	if response["ciphertext"] != wantCiphertext {
		t.Fatalf(
			"ciphertext=%v, want %q",
			response["ciphertext"],
			wantCiphertext,
		)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEncryptedHeadReturnsGetContentLength(t *testing.T) {
	const ciphertext = "cipher"
	const metadata = `{
		"version": 1,
		"mimeType": "application/pdf",
		"sizeBytes": 42
	}`

	newStore := func() *downloadStore {
		return &downloadStore{
			get: func(
				_ context.Context,
				_ string,
				_ string,
				options GetOptions,
			) (*ObjectResponse, error) {
				body := ciphertext
				if options.Head {
					body = ""
				}

				return &ObjectResponse{
					Body:          io.NopCloser(strings.NewReader(body)),
					StatusCode:    http.StatusOK,
					ContentLength: int64(len(ciphertext)),
				}, nil
			},
		}
	}

	getHandler, getMock := newDownloadHandler(
		t,
		newStore(),
		"application/pdf",
		int64(len(ciphertext)),
		true,
		metadata,
	)

	getResponse := serveDownload(
		t,
		getHandler,
		http.MethodGet,
		nil,
	)

	if getResponse.Code != http.StatusOK {
		t.Fatalf(
			"GET status=%d body=%q",
			getResponse.Code,
			getResponse.Body.String(),
		)
	}

	headHandler, headMock := newDownloadHandler(
		t,
		newStore(),
		"application/pdf",
		int64(len(ciphertext)),
		true,
		metadata,
	)

	headResponse := serveDownload(
		t,
		headHandler,
		http.MethodHead,
		nil,
	)

	if headResponse.Code != http.StatusOK {
		t.Fatalf(
			"HEAD status=%d body=%q",
			headResponse.Code,
			headResponse.Body.String(),
		)
	}

	wantLength := strconv.Itoa(getResponse.Body.Len())
	for _, response := range []*httptest.ResponseRecorder{getResponse, headResponse} {
		if response.Header().Get("Cache-Control") != "private, no-cache" || response.Header().Get("Vary") != "Authorization, Cookie" {
			t.Fatalf("unexpected encrypted cache headers: %v", response.Header())
		}
	}
	if got := headResponse.Header().Get("Content-Length"); got != wantLength {
		t.Fatalf(
			"HEAD Content-Length=%q, want %q",
			got,
			wantLength,
		)
	}

	if headResponse.Body.Len() != 0 {
		t.Fatalf(
			"HEAD returned body %q",
			headResponse.Body.String(),
		)
	}

	if err := getMock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if err := headMock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Защищённый ответ не должен переотдаваться без проверки прав, поэтому
// срок жизни кэша снят (#615). Условных запросов нет: ETag и Last-Modified
// не проксируются.
func TestDownloadCacheIsPrivate(t *testing.T) {
	store := &downloadStore{get: func(context.Context, string, string, GetOptions) (*ObjectResponse, error) {
		return objectResponse(http.StatusOK, "stored bytes"), nil
	}}
	handler, mock := newDownloadHandler(t, store, "image/webp", 12, false, nil)

	w := serveDownload(t, handler, http.MethodGet, nil)

	if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control=%q", got)
	}
	if got := w.Header().Get("Vary"); got != "Authorization, Cookie" {
		t.Fatalf("Vary=%q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadCatalogObject(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT uploader_id::text, first_attached_at").WithArgs(testUploadID).WillReturnRows(sqlmock.NewRows([]string{"uploader_id", "first_attached_at"}))
			mock.ExpectQuery("SELECT EXISTS").WithArgs(testUploadID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			mock.ExpectQuery("SELECT bucket, object_key, content_type, size_bytes, is_encrypted, encryption_key_id").WithArgs(testUploadID).
				WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key", "content_type", "size_bytes", "is_encrypted", "encryption_key_id"}))
			mock.ExpectQuery("SELECT bucket, object_key FROM media.stickers").WithArgs(testUploadID).
				WillReturnRows(sqlmock.NewRows([]string{"bucket", "object_key"}).AddRow("catalog", "owner/stickers/1"))
			store := &downloadStore{get: func(_ context.Context, bucket, key string, options GetOptions) (*ObjectResponse, error) {
				if bucket != "catalog" || key != "owner/stickers/1" || options.Head != (method == http.MethodHead) {
					t.Fatalf("unexpected object request: %s %s %+v", bucket, key, options)
				}
				object := objectResponse(http.StatusOK, "sticker bytes")
				object.ContentType = "image/webp"
				return object, nil
			}}
			handler := NewHandler(NewService(db, store, "uploads", defaultTestMaxUploadBytes))
			response := serveDownload(t, handler, method, nil)
			if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/webp" || response.Header().Get("Content-Length") != "13" {
				t.Fatalf("status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
			}
			if method == http.MethodGet && response.Body.String() != "sticker bytes" {
				t.Fatal(response.Body.String())
			}
			if method == http.MethodHead && response.Body.Len() != 0 {
				t.Fatal("HEAD has body")
			}
			if store.presignCalls != 0 || response.Header().Get("Location") != "" {
				t.Fatal("catalog download must not redirect")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
