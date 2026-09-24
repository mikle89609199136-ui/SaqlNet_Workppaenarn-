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
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_BURST", "")

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		authRate:           5,
		authBurst:          10,
		usernameCheckRate:  2,
		usernameCheckBurst: 5,
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
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_RPS", "75.5")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_BURST", "200")

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		authRate:           2.5,
		authBurst:          20,
		usernameCheckRate:  1.5,
		usernameCheckBurst: 8,
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
