// Package ratelimit — лимитер «корзина токенов» с ключом. Состояние в памяти
// процесса, поэтому каждый экземпляр сервиса считает сам.
package ratelimit

import (
	"context"
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter пополняет rate токенов в секунду, но не больше burst. Корзина ключа
// создаётся полной при первом запросе.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64
	burst   float64
}

func New(rate float64, burst int) *Limiter {
	if rate <= 0 || burst < 1 {
		panic("ratelimit: rate must be > 0 and burst must be >= 1")
	}
	return &Limiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		burst:   float64(burst),
	}
}

// Allow забирает токен. При отказе возвращает, через сколько появится следующий.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	return l.allowAt(key, time.Now())
}

func (l *Limiter) allowAt(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	elapsed := max(0, now.Sub(b.last).Seconds())
	b.tokens = min(l.burst, b.tokens+elapsed*l.rate)
	b.last = now

	if b.tokens < 1 {
		missing := 1 - b.tokens
		return false, time.Duration(missing / l.rate * float64(time.Second))
	}
	b.tokens--
	return true, 0
}

func (l *Limiter) refund(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if b, ok := l.buckets[key]; ok {
		b.tokens = min(l.burst, b.tokens+1)
	}
}

type Check struct {
	Limiter *Limiter
	Key     string
}

// AllowAll пропускает, только если токен есть во всех корзинах. Если одна
// отказала, уже взятые токены других возвращаются.
func AllowAll(checks ...Check) (bool, time.Duration) {
	for i, c := range checks {
		if ok, wait := c.Limiter.Allow(c.Key); !ok {
			for _, taken := range checks[:i] {
				taken.Limiter.refund(taken.Key)
			}
			return false, wait
		}
	}
	return true, 0
}

func (l *Limiter) removeStale(now time.Time, ttl time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := now.Add(-ttl)
	for key, b := range l.buckets {
		if b.last.Before(cutoff) {
			delete(l.buckets, key)
		}
	}
}

func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

func (l *Limiter) refillTime() time.Duration {
	return time.Duration(l.burst / l.rate * float64(time.Second))
}

// RunCleanup удаляет простаивающие корзины, пока не отменён ctx. ttl не меньше
// полного пополнения: иначе удалённая неполная корзина вернётся полной.
func (l *Limiter) RunCleanup(ctx context.Context, interval, ttl time.Duration) {
	ttl = max(ttl, l.refillTime())
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			l.removeStale(now, ttl)
		}
	}
}
