package chat

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/platform/ratelimit"
)

const (
	mlsCleanupInterval = time.Minute
	mlsBucketIdleTTL   = 10 * time.Minute
	cryptoRetryAfter   = time.Second
)

type RateLimitedError struct {
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string { return "too many requests" }

// CryptoBusyError отдаём как 503, а не 429: перегружен общий ресурс, а не один клиент.
type CryptoBusyError struct {
	RetryAfter time.Duration
}

func (e *CryptoBusyError) Error() string { return "crypto service is busy" }

var errCryptoUnavailable = errors.New("crypto service unavailable")

type mlsLimits struct {
	user     *ratelimit.Limiter
	kpPair   *ratelimit.Limiter
	kpTarget *ratelimit.Limiter
	// crypto — семафор: занятое место означает вызов в полёте.
	crypto chan struct{}
}

func newMLSLimitsFromEnv() *mlsLimits {
	return &mlsLimits{
		user: ratelimit.New(
			config.PositiveFloat64("CHAT_MLS_USER_RATE_PER_SEC", 5),
			config.PositiveInt("CHAT_MLS_USER_BURST", 10),
		),
		kpPair: ratelimit.New(
			config.PositiveFloat64("CHAT_MLS_KEYPACKAGE_PAIR_RATE_PER_MIN", 1)/60,
			config.PositiveInt("CHAT_MLS_KEYPACKAGE_PAIR_BURST", 2),
		),
		kpTarget: ratelimit.New(
			config.PositiveFloat64("CHAT_MLS_KEYPACKAGE_TARGET_RATE_PER_MIN", 10)/60,
			config.PositiveInt("CHAT_MLS_KEYPACKAGE_TARGET_BURST", 10),
		),
		// 16 — начальное значение, нагрузочным тестом не подтверждено.
		crypto: make(chan struct{}, config.PositiveInt("CHAT_MLS_CRYPTO_MAX_INFLIGHT", 16)),
	}
}

// nil-лимиты ничего не ограничивают: тесты собирают Service без NewService.
func (l *mlsLimits) allowUser(userID string) (bool, time.Duration) {
	if l == nil {
		return true, 0
	}
	return l.user.Allow(userID)
}

// allowKeyPackageFetch вызывать после проверки общего чата, иначе посторонний
// исчерпает лимит адресата.
func (l *mlsLimits) allowKeyPackageFetch(requesterID, targetID string) (bool, time.Duration) {
	if l == nil {
		return true, 0
	}
	return ratelimit.AllowAll(
		ratelimit.Check{Limiter: l.kpPair, Key: requesterID + ">" + targetID},
		ratelimit.Check{Limiter: l.kpTarget, Key: targetID},
	)
}

// acquireCrypto не ждёт: если все места заняты, сразу возвращает false.
func (l *mlsLimits) acquireCrypto() (release func(), ok bool) {
	if l == nil {
		return func() {}, true
	}
	select {
	case l.crypto <- struct{}{}:
		return func() { <-l.crypto }, true
	default:
		return nil, false
	}
}

func (s *Service) RunMLSLimitsCleanup(ctx context.Context) {
	if s.mls == nil {
		return
	}
	var wg sync.WaitGroup
	for _, l := range []*ratelimit.Limiter{s.mls.user, s.mls.kpPair, s.mls.kpTarget} {
		wg.Go(func() { l.RunCleanup(ctx, mlsCleanupInterval, mlsBucketIdleTTL) })
	}
	wg.Wait()
}

// writeIfLimited возвращает true, если err — ошибка лимита и ответ уже записан.
func writeIfLimited(w http.ResponseWriter, r *http.Request, err error) bool {
	var limited *RateLimitedError
	if errors.As(err, &limited) {
		writeRateLimited(w, r, limited.RetryAfter)
		return true
	}
	var busy *CryptoBusyError
	if errors.As(err, &busy) {
		w.Header().Set("Retry-After", retryAfterHeader(busy.RetryAfter))
		httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_busy", "crypto service is busy")
		return true
	}
	return false
}

func retryAfterHeader(wait time.Duration) string {
	return strconv.Itoa(max(1, int(math.Ceil(wait.Seconds()))))
}

func writeRateLimited(w http.ResponseWriter, r *http.Request, wait time.Duration) {
	w.Header().Set("Retry-After", retryAfterHeader(wait))
	httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests")
}
