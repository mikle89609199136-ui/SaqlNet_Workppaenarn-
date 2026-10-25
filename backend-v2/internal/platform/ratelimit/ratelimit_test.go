package ratelimit

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var t0 = time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)

func TestAllowRejectsAfterBurst(t *testing.T) {
	l := New(1, 3)

	for i := range 3 {
		if ok, _ := l.allowAt("u", t0); !ok {
			t.Fatalf("request %d within burst was rejected", i+1)
		}
	}
	if ok, _ := l.allowAt("u", t0); ok {
		t.Fatal("request over burst was allowed")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l := New(1, 1)

	if ok, _ := l.allowAt("alice", t0); !ok {
		t.Fatal("alice first request rejected")
	}
	if ok, _ := l.allowAt("alice", t0); ok {
		t.Fatal("alice second request allowed")
	}
	if ok, _ := l.allowAt("bob", t0); !ok {
		t.Fatal("bob was limited by alice's requests")
	}
}

func TestTokensRefillOverTime(t *testing.T) {
	l := New(2, 2)
	l.allowAt("u", t0)
	l.allowAt("u", t0)

	if ok, _ := l.allowAt("u", t0.Add(400*time.Millisecond)); ok {
		t.Fatal("0.8 of a token must not be enough")
	}
	if ok, _ := l.allowAt("u", t0.Add(500*time.Millisecond)); !ok {
		t.Fatal("one full token should have refilled after 500ms")
	}
}

func TestRefillDoesNotExceedBurst(t *testing.T) {
	l := New(10, 2)
	l.allowAt("u", t0)

	later := t0.Add(time.Hour)
	l.allowAt("u", later)
	l.allowAt("u", later)
	if ok, _ := l.allowAt("u", later); ok {
		t.Fatal("tokens accumulated beyond burst")
	}
}

func TestRetryAfterIsTimeUntilNextToken(t *testing.T) {
	l := New(0.5, 1)
	l.allowAt("u", t0)

	_, wait := l.allowAt("u", t0)
	if wait != 2*time.Second {
		t.Fatalf("wait = %v, want 2s", wait)
	}

	_, wait = l.allowAt("u", t0.Add(500*time.Millisecond))
	if wait != 1500*time.Millisecond {
		t.Fatalf("wait after 500ms = %v, want 1.5s", wait)
	}
}

func TestAllowAllDoesNotConsumeOtherBucketsOnReject(t *testing.T) {
	pair := New(0.001, 5)
	target := New(0.001, 1)

	target.Allow("anna")

	for range 3 {
		ok, _ := AllowAll(Check{pair, "max>anna"}, Check{target, "anna"})
		if ok {
			t.Fatal("request passed although target bucket is empty")
		}
	}

	for i := range 5 {
		if ok, _ := pair.Allow("max>anna"); !ok {
			t.Fatalf("pair token %d was lost on rejected AllowAll", i+1)
		}
	}
}

func TestAllowAllConsumesEveryBucketOnSuccess(t *testing.T) {
	a := New(0.001, 1)
	b := New(0.001, 1)

	if ok, _ := AllowAll(Check{a, "k"}, Check{b, "k"}); !ok {
		t.Fatal("first AllowAll rejected")
	}
	if ok, _ := a.allowAt("k", time.Now()); ok {
		t.Fatal("first bucket was not charged")
	}
	if ok, _ := b.allowAt("k", time.Now()); ok {
		t.Fatal("second bucket was not charged")
	}
}

func TestAllowAllReportsWaitOfRejectingBucket(t *testing.T) {
	fast := New(10, 1)
	slow := New(0.1, 1)
	slow.Allow("k")

	ok, wait := AllowAll(Check{fast, "k"}, Check{slow, "k"})
	if ok {
		t.Fatal("expected rejection")
	}
	if wait < 9*time.Second || wait > 10*time.Second {
		t.Fatalf("wait = %v, want about 10s", wait)
	}
}

func TestRemoveStaleDeletesOnlyIdleBuckets(t *testing.T) {
	l := New(1, 1)
	l.allowAt("old", t0)
	l.allowAt("fresh", t0.Add(9*time.Minute))

	l.removeStale(t0.Add(10*time.Minute), 5*time.Minute)

	if l.Len() != 1 {
		t.Fatalf("Len = %d, want 1", l.Len())
	}
	if _, ok := l.buckets["fresh"]; !ok {
		t.Fatal("fresh bucket was removed")
	}
}

func TestRunCleanupStopsOnContextCancel(t *testing.T) {
	l := New(1, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		l.RunCleanup(ctx, time.Millisecond, time.Minute)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("RunCleanup did not stop after cancel")
	}
}

func TestRunCleanupKeepsBucketsUntilFullyRefilled(t *testing.T) {
	l := New(0.001, 1)
	l.Allow("u")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go l.RunCleanup(ctx, time.Millisecond, time.Millisecond)

	time.Sleep(50 * time.Millisecond)
	if l.Len() != 1 {
		t.Fatal("bucket was removed before it could refill")
	}
}

func TestNewPanicsOnInvalidConfig(t *testing.T) {
	cases := []struct {
		name  string
		rate  float64
		burst int
	}{
		{"zero rate", 0, 1},
		{"negative rate", -1, 1},
		{"zero burst", 1, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("expected panic")
				}
			}()
			New(tc.rate, tc.burst)
		})
	}
}

func TestAllowIsSafeForConcurrentUse(t *testing.T) {
	l := New(0.001, 50)
	var allowed atomic.Int64
	var wg sync.WaitGroup

	for range 200 {
		wg.Go(func() {
			if ok, _ := l.Allow("u"); ok {
				allowed.Add(1)
			}
		})
	}
	wg.Wait()

	if got := allowed.Load(); got != 50 {
		t.Fatalf("allowed = %d, want exactly 50", got)
	}
}
