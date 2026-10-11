package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoadRateLimitConfigUsesDefaults(t *testing.T) {
	t.Setenv("EDGE_RATE_LIMIT_AUTH_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_AUTH_BURST", "")
	t.Setenv("EDGE_RATE_LIMIT_USERNAME_CHECK_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_USERNAME_CHECK_BURST", "")
	t.Setenv("EDGE_RATE_LIMIT_MEDIA_DOWNLOAD_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_MEDIA_DOWNLOAD_BURST", "")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_BURST", "")

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		authRate:           5,
		authBurst:          10,
		usernameCheckRate:  2,
		usernameCheckBurst: 5,
		mediaDownloadRate:  20,
		mediaDownloadBurst: 60,
		globalRate:         50,
		globalBurst:        100,
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}

func TestLoadRateLimitConfigReadsEnvironmentVariables(t *testing.T) {
	t.Setenv("EDGE_RATE_LIMIT_AUTH_RPS", "2.5")
	t.Setenv("EDGE_RATE_LIMIT_AUTH_BURST", "20")
	t.Setenv("EDGE_RATE_LIMIT_USERNAME_CHECK_RPS", "1.5")
	t.Setenv("EDGE_RATE_LIMIT_USERNAME_CHECK_BURST", "8")
	t.Setenv("EDGE_RATE_LIMIT_MEDIA_DOWNLOAD_RPS", "3.5")
	t.Setenv("EDGE_RATE_LIMIT_MEDIA_DOWNLOAD_BURST", "7")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_RPS", "75.5")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_BURST", "200")

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		authRate:           2.5,
		authBurst:          20,
		usernameCheckRate:  1.5,
		usernameCheckBurst: 8,
		mediaDownloadRate:  3.5,
		mediaDownloadBurst: 7,
		globalRate:         75.5,
		globalBurst:        200,
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}

func TestRateLimitMiddlewareLimitsUsernameChecksSeparately(t *testing.T) {
	requestsHandled := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requestsHandled++
		w.WriteHeader(http.StatusOK)
	})
	handler := rateLimitMiddleware(
		trustedProxySet{},
		newTokenBucket(100, 100),
		newTokenBucket(0.000001, 1),
		newTokenBucket(100, 100),
		newTokenBucket(100, 100),
		next,
	)

	firstRequest := httptest.NewRequest(http.MethodGet, "/api/v2/users/check-username?username=alice", nil)
	firstRequest.RemoteAddr = "192.0.2.1:1234"
	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, firstRequest)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("expected first request status 200, got %d", firstResponse.Code)
	}

	secondRequest := httptest.NewRequest(http.MethodGet, "/api/v2/users/check-username?username=bob", nil)
	secondRequest.RemoteAddr = "192.0.2.1:1234"
	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondResponse, secondRequest)
	if secondResponse.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request status 429, got %d", secondResponse.Code)
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(secondResponse.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != "rate_limited" {
		t.Fatalf("expected rate_limited, got %q", body.Code)
	}
	if requestsHandled != 1 {
		t.Fatalf("expected downstream handler to run once, got %d", requestsHandled)
	}
}

func TestRateLimitMiddlewareDoesNotApplyUsernameLimitToOtherRoutes(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rateLimitMiddleware(
		trustedProxySet{},
		newTokenBucket(100, 100),
		newTokenBucket(0.000001, 1),
		newTokenBucket(100, 100),
		newTokenBucket(100, 100),
		next,
	)

	for range 2 {
		request := httptest.NewRequest(http.MethodGet, "/api/v2/users/search?q=alice", nil)
		request.RemoteAddr = "192.0.2.1:1234"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", response.Code)
		}
	}
}

func TestRateLimitMiddlewareLimitsMediaDownloadsSeparately(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	path := "/api/v2/media/11111111-1111-4111-8111-111111111111"
	handler := rateLimitMiddleware(trustedProxySet{}, newTokenBucket(100, 100), newTokenBucket(100, 100), newTokenBucket(0.000001, 1), newTokenBucket(100, 100), next)
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
			if body.Code != "rate_limited" || body.Message != "too many media downloads — slow down" {
				t.Fatalf("unexpected error: %+v", body)
			}
		}
	}
	// Successful downloads also consume the shared IP budget.
	handler = rateLimitMiddleware(trustedProxySet{}, newTokenBucket(100, 100), newTokenBucket(100, 100), newTokenBucket(100, 100), newTokenBucket(0.000001, 1), next)
	for i := range 2 {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodHead, path, nil))
		if (i == 0 && w.Code != 200) || (i == 1 && w.Code != 429) {
			t.Fatalf("global limiter: %d", w.Code)
		}
	}
}

func TestRateLimitMiddlewareOverwritesClientIPHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get(clientIPHeader); got != "192.0.2.44" {
			t.Errorf("forwarded client IP = %q, want %q", got, "192.0.2.44")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	handler := rateLimitMiddleware(
		trustedProxySet{},
		newTokenBucket(100, 100),
		newTokenBucket(100, 100),
		newTokenBucket(100, 100),
		newTokenBucket(100, 100),
		next,
	)

	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/me", nil)
	request.RemoteAddr = "192.0.2.44:1234"
	request.Header.Set(clientIPHeader, "203.0.113.99")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}
