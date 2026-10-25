package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimitMiddlewareLimitsMediaDownloadsSeparately(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	path := "/api/v2/media/11111111-1111-4111-8111-111111111111"
	cfg := loadRateLimitConfig()
	cfg.mediaDownload = bucketConfig{rate: 0.000001, burst: 1}
	handler := rateLimitMiddleware(trustedProxySet{}, newLimiterSet(cfg), next)
	for _, tt := range []struct {
		method, path string
		status       int
	}{
		{http.MethodGet, path, 200}, {http.MethodHead, path, 429},
		{http.MethodGet, "/api/v2/users/me", 200}, {http.MethodPost, "/api/v2/media", 200},
		{http.MethodGet, "/api/v2/media/not-a-uuid", 200}, {http.MethodPost, path, 200},
	} {
		r := httptest.NewRequest(tt.method, tt.path, nil)
		r.RemoteAddr = "192.0.2.1:1234"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tt.status {
			t.Fatalf("%s %s: status %d want %d", tt.method, tt.path, w.Code, tt.status)
		}
		if w.Code == 429 {
			var body struct{ Code, Message string }
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Code != "rate_limited" || body.Message != "too many requests" {
				t.Fatalf("unexpected error: %+v", body)
			}
		}
	}
	// Successful downloads also consume the shared IP budget.
	cfg.mediaDownload = bucketConfig{rate: 100, burst: 100}
	cfg.global = bucketConfig{rate: 0.000001, burst: 1}
	handler = rateLimitMiddleware(trustedProxySet{}, newLimiterSet(cfg), next)
	for i := range 2 {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodHead, path, nil))
		if (i == 0 && w.Code != 200) || (i == 1 && w.Code != 429) {
			t.Fatalf("global limiter: %d", w.Code)
		}
	}
}
