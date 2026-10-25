package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/ratelimit"
)

// /mls/unknown отвечает 404 без БД и crypto: 404 значит «лимит пропустил», 429 — «остановил».
func mlsRequest(t *testing.T, h *Handler, userID, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID}))
	rec := httptest.NewRecorder()
	h.MLSRoutes(rec, req)
	return rec
}

func newMLSLimitTestHandler(userBurst int) *Handler {
	// почти нулевая скорость пополнения: токены не возвращаются за время теста
	svc := &Service{mls: &mlsLimits{user: ratelimit.New(0.001, userBurst)}}
	return NewHandler(svc)
}

func TestMLSUserLimitRejectsWith429AndRetryAfter(t *testing.T) {
	h := newMLSLimitTestHandler(2)

	for i := range 2 {
		if rec := mlsRequest(t, h, "alice", http.MethodGet, "/api/v2/mls/unknown"); rec.Code != http.StatusNotFound {
			t.Fatalf("request %d within burst: status %d, want 404", i+1, rec.Code)
		}
	}

	rec := mlsRequest(t, h, "alice", http.MethodGet, "/api/v2/mls/unknown")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	seconds, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || seconds < 1 {
		t.Fatalf("Retry-After = %q, want integer >= 1", rec.Header().Get("Retry-After"))
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Code != "rate_limited" {
		t.Fatalf("body = %s, want code rate_limited", rec.Body.String())
	}
}

func TestMLSUserLimitDoesNotAffectOtherUsers(t *testing.T) {
	h := newMLSLimitTestHandler(1)

	mlsRequest(t, h, "alice", http.MethodGet, "/api/v2/mls/unknown")
	if rec := mlsRequest(t, h, "alice", http.MethodGet, "/api/v2/mls/unknown"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("alice second request: status %d, want 429", rec.Code)
	}

	if rec := mlsRequest(t, h, "bob", http.MethodGet, "/api/v2/mls/unknown"); rec.Code != http.StatusNotFound {
		t.Fatalf("bob was limited by alice: status %d, want 404", rec.Code)
	}
}

func TestMLSUserLimitIsSharedAcrossAllMLSRoutes(t *testing.T) {
	h := newMLSLimitTestHandler(1)

	mlsRequest(t, h, "alice", http.MethodGet, "/api/v2/mls/unknown")

	routes := []struct{ method, path string }{
		{http.MethodPost, "/api/v2/mls/keypackages"},
		{http.MethodGet, "/api/v2/mls/keypackages/bob"},
		{http.MethodGet, "/api/v2/mls/group/c1/state"},
		{http.MethodPost, "/api/v2/mls/group/c1/commit"},
		{http.MethodPost, "/api/v2/mls/group/c1/welcome"},
		{http.MethodGet, "/api/v2/mls/group/c1/welcome"},
		{http.MethodPost, "/api/v2/mls/group/c1/proposals"},
		{http.MethodGet, "/api/v2/mls/group/c1/proposals"},
	}
	for _, rt := range routes {
		if rec := mlsRequest(t, h, "alice", rt.method, rt.path); rec.Code != http.StatusTooManyRequests {
			t.Errorf("%s %s: status %d, want 429", rt.method, rt.path, rec.Code)
		}
	}
}

func TestMLSLimitsDefaultsFromEnv(t *testing.T) {
	t.Setenv("CHAT_MLS_USER_RATE_PER_SEC", "")
	t.Setenv("CHAT_MLS_USER_BURST", "")
	l := newMLSLimitsFromEnv()

	for i := range 10 {
		if ok, _ := l.allowUser("u"); !ok {
			t.Fatalf("request %d of default burst 10 was rejected", i+1)
		}
	}
	if ok, _ := l.allowUser("u"); ok {
		t.Fatal("11th request passed, default burst must be 10")
	}
}

func TestMLSLimitsReadOverridesFromEnv(t *testing.T) {
	t.Setenv("CHAT_MLS_USER_RATE_PER_SEC", "1")
	t.Setenv("CHAT_MLS_USER_BURST", "3")
	l := newMLSLimitsFromEnv()

	for range 3 {
		l.allowUser("u")
	}
	if ok, _ := l.allowUser("u"); ok {
		t.Fatal("4th request passed, burst override 3 was ignored")
	}
}

func newCryptoGateLimits(capacity int) *mlsLimits {
	return &mlsLimits{
		user:   ratelimit.New(1000, 1000),
		crypto: make(chan struct{}, capacity),
	}
}

func TestAcquireCryptoRefusesImmediatelyWhenFullAndReleaseFreesSlot(t *testing.T) {
	l := newCryptoGateLimits(2)

	release1, ok1 := l.acquireCrypto()
	_, ok2 := l.acquireCrypto()
	if !ok1 || !ok2 {
		t.Fatal("slots within capacity were refused")
	}
	if _, ok := l.acquireCrypto(); ok {
		t.Fatal("third acquire succeeded with capacity 2")
	}

	release1()
	if _, ok := l.acquireCrypto(); !ok {
		t.Fatal("slot was not freed by release")
	}
}

func TestAcquireCryptoOnNilLimitsNeverRefuses(t *testing.T) {
	var l *mlsLimits
	release, ok := l.acquireCrypto()
	if !ok {
		t.Fatal("nil limits refused a call")
	}
	release()
}

func TestMLSCryptoMaxInFlightDefaultsAndOverride(t *testing.T) {
	t.Setenv("CHAT_MLS_CRYPTO_MAX_INFLIGHT", "")
	if got := cap(newMLSLimitsFromEnv().crypto); got != 16 {
		t.Fatalf("default cap = %d, want 16", got)
	}
	t.Setenv("CHAT_MLS_CRYPTO_MAX_INFLIGHT", "4")
	if got := cap(newMLSLimitsFromEnv().crypto); got != 4 {
		t.Fatalf("overridden cap = %d, want 4", got)
	}
}

type blockingCrypto struct {
	*httptest.Server
	release  chan struct{}
	inFlight atomic.Int32
	maxSeen  atomic.Int32
	entered  chan struct{}
}

func newBlockingCrypto(t *testing.T) *blockingCrypto {
	t.Helper()
	b := &blockingCrypto{release: make(chan struct{}), entered: make(chan struct{}, 100)}
	b.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		cur := b.inFlight.Add(1)
		for {
			prev := b.maxSeen.Load()
			if cur <= prev || b.maxSeen.CompareAndSwap(prev, cur) {
				break
			}
		}
		b.entered <- struct{}{}
		<-b.release
		b.inFlight.Add(-1)
		_, _ = w.Write([]byte(`{"valid":true,"key_id":"k","next_epoch":1}`))
	}))
	t.Cleanup(b.Close)
	return b
}

func TestCallCryptoNeverExceedsInFlightCeilingAndRefusesTheRest(t *testing.T) {
	const ceiling, callers = 3, 10
	crypto := newBlockingCrypto(t)
	svc := &Service{mls: newCryptoGateLimits(ceiling)}

	results := make(chan error, callers)
	for range callers {
		go func() {
			_, err := svc.callCrypto(context.Background(), crypto.URL, "/x", map[string]string{})
			results <- err
		}()
	}

	var busy int
	deadline := time.After(3 * time.Second)
	for busy < callers-ceiling {
		select {
		case err := <-results:
			var b *CryptoBusyError
			if !errors.As(err, &b) {
				t.Fatalf("call finished with %v, want CryptoBusyError", err)
			}
			busy++
		case <-deadline:
			t.Fatalf("only %d of %d surplus calls were refused; surplus calls are waiting", busy, callers-ceiling)
		}
	}
	for range ceiling {
		select {
		case <-crypto.entered:
		case <-time.After(3 * time.Second):
			t.Fatal("admitted calls never reached crypto")
		}
	}
	if got := crypto.inFlight.Load(); got != ceiling {
		t.Fatalf("in flight = %d, want %d", got, ceiling)
	}

	close(crypto.release)
	for range ceiling {
		if err := <-results; err != nil {
			t.Fatalf("admitted call failed: %v", err)
		}
	}
	if got := crypto.maxSeen.Load(); got > ceiling {
		t.Fatalf("crypto saw %d concurrent requests, ceiling is %d", got, ceiling)
	}

	if _, err := svc.callCrypto(context.Background(), crypto.URL, "/x", map[string]string{}); err != nil {
		t.Fatalf("call after release failed: %v", err)
	}
}

func TestCallCryptoReleasesSlotWhenCryptoFails(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	svc := &Service{mls: newCryptoGateLimits(1)}

	for i := range 3 {
		_, err := svc.callCrypto(context.Background(), url, "/x", map[string]string{})
		var busy *CryptoBusyError
		if errors.As(err, &busy) {
			t.Fatalf("call %d: slot leaked after failed crypto call", i+1)
		}
		if err == nil {
			t.Fatalf("call %d to a dead crypto succeeded", i+1)
		}
	}
}

func uploadKeyPackagesRequest(h *Handler) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v2/mls/keypackages", strings.NewReader(`{"keypackages":["AAAA"]}`))
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: "alice"}))
	rec := httptest.NewRecorder()
	h.MLSRoutes(rec, req)
	return rec
}

func TestMLSUploadAnswers503WithRetryAfterWhenCryptoIsBusy(t *testing.T) {
	limits := newCryptoGateLimits(1)
	limits.crypto <- struct{}{}
	h := NewHandler(&Service{mls: limits})

	rec := uploadKeyPackagesRequest(h)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("Retry-After = %q, want 1", rec.Header().Get("Retry-After"))
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Code != "crypto_busy" {
		t.Fatalf("body = %s, want code crypto_busy", rec.Body.String())
	}
}

func TestMLSUploadAnswers503WhenCryptoIsUnreachable(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	t.Setenv("CRYPTO_URL", dead.URL)
	dead.Close()
	h := NewHandler(&Service{mls: newCryptoGateLimits(1)})

	rec := uploadKeyPackagesRequest(h)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Code != "crypto_unavailable" {
		t.Fatalf("body = %s, want code crypto_unavailable", rec.Body.String())
	}
}
