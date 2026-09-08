package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"sync"
	"testing"
	"time"
)

type edgeRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn edgeRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type edgeGatedBody struct {
	chunks  [][]byte
	release <-chan struct{}
	index   int
}

func (r *edgeGatedBody) Read(p []byte) (int, error) {
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

func (r *edgeGatedBody) Close() error { return nil }

type edgeDeadlineWriter struct {
	mu             sync.Mutex
	header         http.Header
	status         int
	body           bytes.Buffer
	deadline       time.Time
	expired        bool
	firstWrite     chan struct{}
	firstWriteOnce sync.Once
}

func newEdgeDeadlineWriter() *edgeDeadlineWriter {
	return &edgeDeadlineWriter{
		header:     make(http.Header),
		firstWrite: make(chan struct{}),
	}
}

func (w *edgeDeadlineWriter) Header() http.Header { return w.header }

func (w *edgeDeadlineWriter) WriteHeader(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.status = status
}

func (w *edgeDeadlineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.expired && !w.deadline.IsZero() {
		return 0, context.DeadlineExceeded
	}
	n, err := w.body.Write(p)
	w.firstWriteOnce.Do(func() { close(w.firstWrite) })
	return n, err
}

func (w *edgeDeadlineWriter) Flush() {}

func (w *edgeDeadlineWriter) SetWriteDeadline(deadline time.Time) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.deadline = deadline
	return nil
}

func (w *edgeDeadlineWriter) expire() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.expired = true
}

func (w *edgeDeadlineWriter) result() (int, string, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.status, w.body.String(), w.deadline.IsZero()
}

func waitForEdgeSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for controlled edge stream")
	}
}

func TestMediaDownloadThroughEdgeClearsExpiredWriteDeadline(t *testing.T) {
	release := make(chan struct{})
	upstreamBody := &edgeGatedBody{
		chunks:  [][]byte{[]byte("first"), []byte("second")},
		release: release,
	}
	target, err := url.Parse("http://media.test")
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = edgeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			Body:          upstreamBody,
			ContentLength: 11,
			Header:        http.Header{"Content-Type": []string{"video/mp4"}},
		}, nil
	})
	mux := http.NewServeMux()
	registerMediaRoutes(mux, proxy)
	w := newEdgeDeadlineWriter()
	_ = w.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))
	req := httptest.NewRequest(http.MethodGet, "/api/v2/media/11111111-1111-1111-1111-111111111111", nil)
	done := make(chan struct{})
	go func() {
		defer close(done)
		mux.ServeHTTP(w, req)
	}()

	waitForEdgeSignal(t, w.firstWrite)
	w.expire()
	close(release)
	waitForEdgeSignal(t, done)

	status, body, deadlineCleared := w.result()
	if !deadlineCleared {
		t.Fatal("edge media download route did not clear the write deadline")
	}
	if status != http.StatusOK || body != "firstsecond" {
		t.Fatalf("status=%d body=%q", status, body)
	}
}

func TestOnlyMediaDownloadRoutesClearWriteDeadline(t *testing.T) {
	const mediaID = "11111111-1111-1111-1111-111111111111"
	tests := []struct {
		name        string
		method      string
		path        string
		wantCleared bool
	}{
		{name: "get download", method: http.MethodGet, path: "/api/v2/media/" + mediaID, wantCleared: true},
		{name: "head download", method: http.MethodHead, path: "/api/v2/media/" + mediaID, wantCleared: true},
		{name: "upload", method: http.MethodPost, path: "/api/v2/media", wantCleared: false},
		{name: "post with media id", method: http.MethodPost, path: "/api/v2/media/" + mediaID, wantCleared: false},
		{name: "nested media route", method: http.MethodGet, path: "/api/v2/media/" + mediaID + "/metadata", wantCleared: false},
		{name: "invalid media id", method: http.MethodGet, path: "/api/v2/media/not-a-uuid", wantCleared: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mux := http.NewServeMux()
			registerMediaRoutes(mux, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			}))
			w := newEdgeDeadlineWriter()
			_ = w.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))

			mux.ServeHTTP(w, httptest.NewRequest(test.method, test.path, nil))

			_, _, deadlineCleared := w.result()
			if deadlineCleared != test.wantCleared {
				t.Fatalf("deadlineCleared=%v, want %v", deadlineCleared, test.wantCleared)
			}
		})
	}
}

func TestNonMediaRouteRemainsSubjectToWriteDeadline(t *testing.T) {
	release := make(chan struct{})
	secondWrite := make(chan error, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("first"))
		<-release
		_, err := w.Write([]byte("second"))
		secondWrite <- err
	})
	w := newEdgeDeadlineWriter()
	_ = w.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))
	done := make(chan struct{})
	go func() {
		defer close(done)
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	}()

	waitForEdgeSignal(t, w.firstWrite)
	w.expire()
	close(release)
	waitForEdgeSignal(t, done)

	if err := <-secondWrite; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected expired write deadline, got %v", err)
	}
	_, body, deadlineCleared := w.result()
	if deadlineCleared || body != "first" {
		t.Fatalf("deadlineCleared=%v body=%q", deadlineCleared, body)
	}
}

func TestMediaProxyStillPropagatesClientCancellation(t *testing.T) {
	started := make(chan struct{})
	canceled := make(chan struct{})
	target, err := url.Parse("http://media.test")
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = edgeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		close(canceled)
		return nil, request.Context().Err()
	})
	proxy.ErrorHandler = func(http.ResponseWriter, *http.Request, error) {}
	mux := http.NewServeMux()
	registerMediaRoutes(mux, proxy)
	requestContext, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v2/media/11111111-1111-1111-1111-111111111111", nil).WithContext(requestContext)
	done := make(chan struct{})
	go func() {
		defer close(done)
		mux.ServeHTTP(newEdgeDeadlineWriter(), req)
	}()

	waitForEdgeSignal(t, started)
	cancel()
	waitForEdgeSignal(t, canceled)
	waitForEdgeSignal(t, done)
}
