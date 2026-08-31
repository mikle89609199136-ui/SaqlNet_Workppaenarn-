package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLimiterSetDoesNotConsumeGroupTokenWhenGlobalRejects(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	groupLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    1,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: groupLimiter,
		},
		global: globalLimiter,
	}

	allow, _ := limiters.AllowRequest(ip, routeGroupMessageWrite)
	if allow {
		t.Fatalf("expected request to be rejected")
	}

	groupLimiter.mu.Lock()
	remainingTokens := groupLimiter.buckets[ip].tokens
	groupLimiter.mu.Unlock()

	if remainingTokens != 1 {
		t.Fatalf("expected group token to remain, got %v", remainingTokens)
	}
}

func TestLimiterSetDoesNotConsumeGlobalTokenWhenGroupRejects(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	groupLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    1,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: groupLimiter,
		},
		global: globalLimiter,
	}

	allow, _ := limiters.AllowRequest(ip, routeGroupMessageWrite)
	if allow {
		t.Fatalf("expected request to be rejected")
	}

	globalLimiter.mu.Lock()
	remainingTokens := globalLimiter.buckets[ip].tokens
	globalLimiter.mu.Unlock()

	if remainingTokens != 1 {
		t.Fatalf("expected global token to remain, got %v", remainingTokens)
	}
}

func TestLimiterSetConsumesGroupAndGlobalTokensOnSuccess(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	groupLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    2,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 2,
	}

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    3,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 3,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: groupLimiter,
		},
		global: globalLimiter,
	}

	allow, _ := limiters.AllowRequest(ip, routeGroupMessageWrite)
	if !allow {
		t.Fatalf("expected request to be allowed")
	}

	groupLimiter.mu.Lock()
	remainingGroupTokens := groupLimiter.buckets[ip].tokens
	groupLimiter.mu.Unlock()

	globalLimiter.mu.Lock()
	remainingGlobalTokens := globalLimiter.buckets[ip].tokens
	globalLimiter.mu.Unlock()

	if remainingGroupTokens != 1 {
		t.Fatalf(
			"expected 1 group token, got %v",
			remainingGroupTokens,
		)
	}

	if remainingGlobalTokens != 2 {
		t.Fatalf(
			"expected 2 global tokens, got %v",
			remainingGlobalTokens,
		)
	}
}

func TestLimiterSetKeepsRouteGroupsIndependent(t *testing.T) {
	ip := "192.0.2.10"

	messageWriteLimiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 1,
	}

	messageReadLimiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 1,
	}

	globalLimiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 2,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: messageWriteLimiter,
			routeGroupMessageRead:  messageReadLimiter,
		},
		global: globalLimiter,
	}

	firstWriteAllowed, _ := limiters.AllowRequest(ip, routeGroupMessageWrite)
	if !firstWriteAllowed {
		t.Fatal("expected first message-write request to be allowed")
	}

	secondWriteAllowed, _ := limiters.AllowRequest(ip, routeGroupMessageWrite)
	if secondWriteAllowed {
		t.Fatal("expected second message-write request to be rejected")
	}

	readAllowed, _ := limiters.AllowRequest(ip, routeGroupMessageRead)
	if !readAllowed {
		t.Fatal("expected message-read request to be allowed")
	}
}

func TestTokenBucketEnforcesBurstBoundary(t *testing.T) {
	ip := "192.0.2.10"

	limiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 2,
	}

	if !limiter.Allow(ip) {
		t.Fatal("expected first request to be allowed")
	}

	if !limiter.Allow(ip) {
		t.Fatal("expected second request to be allowed")
	}

	if limiter.Allow(ip) {
		t.Fatal("expected third request to be rejected")
	}
}

func TestTokenBucketRefillsTokens(t *testing.T) {
	ip := "192.0.2.10"
	start := time.Now()

	limiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: start,
			},
		},
		rate:     2,
		capacity: 2,
	}

	afterHalfSecond := start.Add(500 * time.Millisecond)

	if !limiter.allowAt(ip, afterHalfSecond) {
		t.Fatal("expected request to be allowed after token refill")
	}

	if limiter.allowAt(ip, afterHalfSecond) {
		t.Fatal("expected second request without additional refill to be rejected")
	}
}

func TestRateLimitMiddlewareSetsRetryAfter(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	messageWriteLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     1,
		capacity: 1,
	}

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    1,
				lastRefil: now,
			},
		},
		rate:     1,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: messageWriteLimiter,
		},
		global: globalLimiter,
	}

	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/message-id", nil)
	req.RemoteAddr = ip + ":12345"

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, recorder.Code)
	}

	if got := recorder.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("expected Retry-After header to be set to 1, got %q", got)
	}

	if nextCalled {
		t.Fatal("expected next handler not to be called")
	}
}

func TestRetryAfter(t *testing.T) {
	tests := []struct {
		name   string
		tokens float64
		rate   float64
		want   time.Duration
	}{
		{
			name:   "no tokens, rate 1",
			tokens: 0,
			rate:   1,
			want:   time.Second,
		},
		{
			name:   "half token, rate 1",
			tokens: 0.5,
			rate:   1,
			want:   500 * time.Millisecond,
		},
		{
			name:   "one token, rate 1",
			tokens: 1,
			rate:   1,
			want:   0,
		},
		{
			name:   "rate <= 0",
			tokens: 0,
			rate:   0,
			want:   time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := retryAfter(tt.tokens, tt.rate)
			if got != tt.want {
				t.Errorf("retryAfter(%v, %v) = %v; want %v", tt.tokens, tt.rate, got, tt.want)
			}
		})
	}
}

func TestAllowRequestNoGroupUsesGlobalOnly(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    1,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{},
		global: globalLimiter,
	}

	allow, _ := limiters.AllowRequest(ip, routeGroupNone)
	if !allow {
		t.Fatalf("expected request to be allowed")
	}

	globalLimiter.mu.Lock()
	remainingTokens := globalLimiter.buckets[ip].tokens
	globalLimiter.mu.Unlock()

	if remainingTokens != 0 {
		t.Fatalf("expected global token to be consumed, got %v", remainingTokens)
	}
}

func TestAllowRequestNoGroupRejectsWhenGlobalEmpty(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{},
		global: globalLimiter,
	}

	allow, wait := limiters.AllowRequest(ip, routeGroupNone)
	if allow {
		t.Fatalf("expected request to be rejected")
	}

	if wait <= 0 {
		t.Fatalf("expected a positive retry-after hint, got %v", wait)
	}
}

func TestRateLimitMiddlewareSkipsExemptPaths(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{},
		global: globalLimiter,
	}

	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	req := httptest.NewRequest(http.MethodOptions, "/api/v2/messages/x", nil)
	req.RemoteAddr = ip + ":12345"

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if !nextCalled {
		t.Fatalf("expected next handler to be called")
	}

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
}

func TestRateLimitMiddlewareReturns429Body(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	groupLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0,
				lastRefil: now,
			},
		},
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: groupLimiter,
		},
		global: globalLimiter,
	}

	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/x", nil)
	req.RemoteAddr = ip + ":12345"

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	var got struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}

	err := json.Unmarshal(recorder.Body.Bytes(), &got)
	if err != nil {
		t.Fatalf("failed to unmarshal response body: %v", err)
	}

	if got.Code != "rate_limited" {
		t.Fatalf("expected code 'rate_limited', got %q", got.Code)
	}

	if got.Message != "too many requests" {
		t.Fatalf("expected message 'too many requests', got %q", got.Message)
	}

	if nextCalled {
		t.Fatalf("expected next handler not to be called")
	}

	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, recorder.Code)
	}
}

func TestClassifyRouteFallsThroughToNone(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   routeGroup
	}{
		{
			name:   "docs spec",
			method: http.MethodGet,
			path:   "/docs/openapi.yml",
			want:   routeGroupNone,
		},
		{
			name:   "docs index",
			method: http.MethodGet,
			path:   "/docs/",
			want:   routeGroupNone,
		},
		{
			name:   "metrics",
			method: http.MethodGet,
			path:   "/metrics",
			want:   routeGroupNone,
		},
		{
			name:   "root",
			method: http.MethodGet,
			path:   "/",
			want:   routeGroupNone,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyRoute(tt.method, tt.path)
			if got != tt.want {
				t.Errorf("classifyRoute(%q, %q) = %v; want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

func TestTokenBucketAllowIsConcurrencySafe(t *testing.T) {
	ip := "192.0.2.10"

	bucket := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 100,
	}

	var allowed atomic.Int64
	var wg sync.WaitGroup
	wg.Add(500)

	for i := 0; i < 500; i++ {
		go func() {
			defer wg.Done()
			if bucket.Allow(ip) {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()

	if allowed.Load() != 100 {
		t.Fatalf("expected 100 allowed requests, got %d", allowed.Load())
	}
}
