package httpx

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMiddlewareAddsRequestIDAndSecurityHeaders(t *testing.T) {
	handler := Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	request := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Fatal("expected request ID header")
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("expected nosniff header")
	}
}

func TestDisableWriteDeadlineAllowsUnsupportedTestWriter(t *testing.T) {
	if err := DisableWriteDeadline(httptest.NewRecorder()); err != nil {
		t.Fatalf("unexpected error for unsupported test writer: %v", err)
	}
}

type deadlineErrorWriter struct {
	*httptest.ResponseRecorder
	err error
}

func (w *deadlineErrorWriter) SetWriteDeadline(time.Time) error { return w.err }

func TestDisableWriteDeadlineReturnsUnexpectedError(t *testing.T) {
	want := errors.New("set deadline failed")
	w := &deadlineErrorWriter{ResponseRecorder: httptest.NewRecorder(), err: want}

	if err := DisableWriteDeadline(w); !errors.Is(err, want) {
		t.Fatalf("expected %v, got %v", want, err)
	}
}
