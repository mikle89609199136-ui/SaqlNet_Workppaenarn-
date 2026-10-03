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

func TestAllowRequestNoGroupRetryAfterUsesCurrentBalance(t *testing.T) {
	ip := "192.0.2.10"

	globalLimiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {
				tokens:    0.9,
				lastRefil: time.Now(),
			},
		},
		rate:     0.1,
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

	// до целого токена не хватает 0.1, при 0.1 токена/с это около секунды, а не десять
	if wait < 900*time.Millisecond || wait > 1100*time.Millisecond {
		t.Fatalf("expected retry-after about 1s for balance 0.9 at 0.1/s, got %v", wait)
	}
}

func TestRateLimitMiddlewareNoGroupRetryAfterUsesCurrentBalance(t *testing.T) {
	ip := "192.0.2.10"

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{},
		global: &tokenBucket{
			buckets: map[string]*bucket{
				ip: {
					tokens:    0.9,
					lastRefil: time.Now(),
				},
			},
			rate:     0.1,
			capacity: 1,
		},
	}

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/docs/openapi.yml", nil)
	req.RemoteAddr = ip + ":12345"

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, recorder.Code)
	}

	if got := recorder.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("expected Retry-After 1, got %q", got)
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

// Корзины ключуются доверенным IP, поэтому расход токенов одним клиентом не
// должен влиять на другого. Проверяем и на уровне tokenBucket, и на уровне
// limiterSet: групповая и глобальная корзины ключуются независимо.
func TestTokenBucketKeepsIPsIndependent(t *testing.T) {
	first := "192.0.2.10"
	second := "192.0.2.11"

	limiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 1,
	}

	if !limiter.Allow(first) {
		t.Fatal("expected first IP to spend its only token")
	}

	if limiter.Allow(first) {
		t.Fatal("expected first IP to be rejected after its bucket is empty")
	}

	if !limiter.Allow(second) {
		t.Fatal("expected second IP to have its own full bucket")
	}
}

func TestLimiterSetKeepsIPsIndependent(t *testing.T) {
	exhausted := "192.0.2.10"
	fresh := "192.0.2.11"
	now := time.Now()

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupMessageWrite: {
				buckets: map[string]*bucket{
					exhausted: {tokens: 0, lastRefil: now},
				},
				rate:     0,
				capacity: 1,
			},
		},
		global: &tokenBucket{
			buckets: map[string]*bucket{
				exhausted: {tokens: 0, lastRefil: now},
			},
			rate:     0,
			capacity: 1,
		},
	}

	if allowed, _ := limiters.AllowRequest(exhausted, routeGroupMessageWrite); allowed {
		t.Fatal("expected the exhausted IP to be rejected")
	}

	allowed, wait := limiters.AllowRequest(fresh, routeGroupMessageWrite)
	if !allowed {
		t.Fatalf("expected another IP to be allowed, got rejected with wait %v", wait)
	}

	// Проверяем, что для нового IP корзины действительно созданы отдельно,
	// а не переиспользована корзина исчерпанного клиента.
	if got := len(limiters.groups[routeGroupMessageWrite].buckets); got != 2 {
		t.Fatalf("expected 2 group buckets, got %d", got)
	}

	if got := len(limiters.global.buckets); got != 2 {
		t.Fatalf("expected 2 global buckets, got %d", got)
	}
}

// Подделанный X-Forwarded-For от недоверенного отправителя не должен давать
// новую корзину: иначе любой клиент обходил бы лимит, меняя заголовок.
// Проверяем сквозь middleware, а не только clientIP().
func TestRateLimitMiddlewareIgnoresSpoofedForwardedFor(t *testing.T) {
	const attackerIP = "203.0.113.5"

	// Список доверенных proxy пуст: отправитель запроса никем не доверен.
	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupLoginRegister: {
				buckets:  make(map[string]*bucket),
				rate:     0,
				capacity: 2,
			},
		},
		global: &tokenBucket{
			buckets:  make(map[string]*bucket),
			rate:     0,
			capacity: 100,
		},
	}

	var nextCalls int
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalls++
		w.WriteHeader(http.StatusOK)
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	// Каждый запрос приходит с новым подделанным X-Forwarded-For, но с одного
	// и того же RemoteAddr. Корзина burst = 2, значит третий запрос обязан
	// получить 429, несмотря на смену заголовка.
	spoofed := []string{"198.51.100.1", "198.51.100.2", "198.51.100.3"}
	wantCodes := []int{http.StatusOK, http.StatusOK, http.StatusTooManyRequests}

	for i, forwarded := range spoofed {
		req := httptest.NewRequest(http.MethodPost, "/api/v2/auth/login", nil)
		req.RemoteAddr = attackerIP + ":12345"
		req.Header.Set("X-Forwarded-For", forwarded)

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)

		if recorder.Code != wantCodes[i] {
			t.Fatalf("request %d with X-Forwarded-For %q: expected status %d, got %d",
				i+1, forwarded, wantCodes[i], recorder.Code)
		}
	}

	if nextCalls != 2 {
		t.Fatalf("expected downstream handler to run twice, got %d", nextCalls)
	}

	// Все три запроса должны попасть в одну корзину — по RemoteAddr.
	groupBuckets := limiters.groups[routeGroupLoginRegister].buckets
	if len(groupBuckets) != 1 {
		t.Fatalf("expected exactly 1 group bucket keyed by RemoteAddr, got %d: %v",
			len(groupBuckets), groupBuckets)
	}

	if _, ok := groupBuckets[attackerIP]; !ok {
		t.Fatalf("expected the bucket to be keyed by %q, got keys %v", attackerIP, groupBuckets)
	}
}

// Обратная сторона: если отправитель действительно доверенный proxy, разные
// X-Forwarded-For должны давать разные корзины, иначе все клиенты за proxy
// делили бы один лимит.
func TestRateLimitMiddlewareSeparatesClientsBehindTrustedProxy(t *testing.T) {
	trusted, err := parseTrustedProxies("203.0.113.5")
	if err != nil {
		t.Fatalf("parse trusted proxies: %v", err)
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupLoginRegister: {
				buckets:  make(map[string]*bucket),
				rate:     0,
				capacity: 1,
			},
		},
		global: &tokenBucket{
			buckets:  make(map[string]*bucket),
			rate:     0,
			capacity: 100,
		},
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := rateLimitMiddleware(trusted, limiters, next)

	doRequest := func(forwarded string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v2/auth/login", nil)
		req.RemoteAddr = "203.0.113.5:12345"
		req.Header.Set("X-Forwarded-For", forwarded)

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder.Code
	}

	if got := doRequest("198.51.100.1"); got != http.StatusOK {
		t.Fatalf("expected first client to be allowed, got %d", got)
	}

	if got := doRequest("198.51.100.1"); got != http.StatusTooManyRequests {
		t.Fatalf("expected the same client to be rejected after burst, got %d", got)
	}

	if got := doRequest("198.51.100.2"); got != http.StatusOK {
		t.Fatalf("expected a different client behind the proxy to have its own bucket, got %d", got)
	}
}

func TestRemoveStaleBucketsDropsIdleBucketsOnly(t *testing.T) {
	now := time.Now()
	const ttl = 10 * time.Minute

	limiter := &tokenBucket{
		buckets: map[string]*bucket{
			"192.0.2.1": {tokens: 1, lastRefil: now.Add(-11 * time.Minute)},
			"192.0.2.2": {tokens: 1, lastRefil: now.Add(-ttl)},
			"192.0.2.3": {tokens: 1, lastRefil: now.Add(-9 * time.Minute)},
			"192.0.2.4": {tokens: 1, lastRefil: now},
		},
		rate:     1,
		capacity: 1,
	}

	limiter.removeStaleBuckets(now, ttl)

	// Граница невключающая: lastRefil ровно на cutoff не Before(cutoff), остаётся.
	want := map[string]bool{
		"192.0.2.1": false,
		"192.0.2.2": true,
		"192.0.2.3": true,
		"192.0.2.4": true,
	}

	for ip, shouldRemain := range want {
		_, remains := limiter.buckets[ip]
		if remains != shouldRemain {
			t.Errorf("bucket %s: expected remains=%v, got %v", ip, shouldRemain, remains)
		}
	}

	if len(limiter.buckets) != 3 {
		t.Fatalf("expected 3 buckets left, got %d", len(limiter.buckets))
	}
}

func TestRemoveStaleBucketsGivesFullBurstAgain(t *testing.T) {
	ip := "192.0.2.10"
	now := time.Now()
	const ttl = 10 * time.Minute

	limiter := &tokenBucket{
		buckets: map[string]*bucket{
			ip: {tokens: 0, lastRefil: now.Add(-11 * time.Minute)},
		},
		rate:     0,
		capacity: 5,
	}

	limiter.removeStaleBuckets(now, ttl)

	// Корзина удалена, поэтому следующий запрос создаёт её заново и получает
	// полный burst. Это ожидаемое поведение: клиент, молчавший дольше ttl, и
	// так накопил бы полную корзину за счёт refill.
	if !limiter.allowAt(ip, now) {
		t.Fatal("expected a request after cleanup to be allowed")
	}

	if got := limiter.buckets[ip].tokens; got != 4 {
		t.Fatalf("expected 4 tokens left from a fresh burst of 5, got %v", got)
	}
}

// Эти два теста заменяют TestRateLimitMiddlewareLimitsUsernameChecksSeparately и
// TestRateLimitMiddlewareDoesNotApplyUsernameLimitToOtherRoutes, удалённые при
// слиянии с dev: прежний отдельный лимитер username-check заменён группой
// маршрутов, но проверяемое поведение осталось тем же.
func TestRateLimitMiddlewareLimitsUsernameChecksSeparately(t *testing.T) {
	ip := "192.0.2.10"

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupUsernameCheck: {
				buckets:  make(map[string]*bucket),
				rate:     0,
				capacity: 1,
			},
			routeGroupOtherAPI: {
				buckets:  make(map[string]*bucket),
				rate:     0,
				capacity: 100,
			},
		},
		global: &tokenBucket{
			buckets:  make(map[string]*bucket),
			rate:     0,
			capacity: 100,
		},
	}

	var handled int
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handled++
		w.WriteHeader(http.StatusOK)
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	checkUsername := func(username string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/v2/users/check-username?username="+username, nil)
		req.RemoteAddr = ip + ":12345"

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}

	if got := checkUsername("alice").Code; got != http.StatusOK {
		t.Fatalf("expected the first check to be allowed, got %d", got)
	}

	second := checkUsername("bob")
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("expected the second check to be rejected, got %d", second.Code)
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(second.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if body.Code != "rate_limited" {
		t.Fatalf("expected error code rate_limited, got %q", body.Code)
	}

	if handled != 1 {
		t.Fatalf("expected the downstream handler to run once, got %d", handled)
	}

	// Исчерпанная проверка имени не должна закрывать остальные API: у них своя
	// корзина. Иначе перебор юзернеймов ломал бы работу приложения целиком.
	otherAPI := httptest.NewRequest(http.MethodGet, "/api/v2/users/search?q=alice", nil)
	otherAPI.RemoteAddr = ip + ":12345"

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, otherAPI)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected another API route to stay available, got %d", recorder.Code)
	}
}

// Обратная сторона: строгий лимит проверки имени не должен применяться к
// остальным маршрутам /api/v2/users/.
func TestRateLimitMiddlewareDoesNotApplyUsernameLimitToOtherRoutes(t *testing.T) {
	ip := "192.0.2.10"

	usernameCheckLimiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupUsernameCheck: usernameCheckLimiter,
			routeGroupOtherAPI: {
				buckets:  make(map[string]*bucket),
				rate:     0,
				capacity: 100,
			},
		},
		global: &tokenBucket{
			buckets:  make(map[string]*bucket),
			rate:     0,
			capacity: 100,
		},
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	for range 3 {
		req := httptest.NewRequest(http.MethodGet, "/api/v2/users/search?q=alice", nil)
		req.RemoteAddr = ip + ":12345"

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected status 200 for a non-username route, got %d", recorder.Code)
		}
	}

	// Корзина проверки имени не должна быть тронута ни разу.
	if len(usernameCheckLimiter.buckets) != 0 {
		t.Fatalf("expected the username-check bucket to stay untouched, got %v", usernameCheckLimiter.buckets)
	}
}

// Перебор юзернеймов не должен съедать попытки входа: у login-register своя
// корзина, и она рассчитана на защиту от подбора паролей.
func TestUsernameCheckDoesNotConsumeLoginRegisterTokens(t *testing.T) {
	ip := "192.0.2.10"

	loginRegisterLimiter := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     0,
		capacity: 1,
	}

	limiters := &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupUsernameCheck: {
				buckets:  make(map[string]*bucket),
				rate:     0,
				capacity: 5,
			},
			routeGroupLoginRegister: loginRegisterLimiter,
		},
		global: &tokenBucket{
			buckets:  make(map[string]*bucket),
			rate:     0,
			capacity: 100,
		},
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := rateLimitMiddleware(trustedProxySet{}, limiters, next)

	for range 5 {
		req := httptest.NewRequest(http.MethodGet, "/api/v2/users/check-username?username=alice", nil)
		req.RemoteAddr = ip + ":12345"
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}

	login := httptest.NewRequest(http.MethodPost, "/api/v2/auth/login", nil)
	login.RemoteAddr = ip + ":12345"

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, login)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected the login attempt to keep its own tokens, got %d", recorder.Code)
	}
}
