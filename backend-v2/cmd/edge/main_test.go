package main

import "testing"

func TestLoadRateLimitConfigUsesDefaults(t *testing.T) {
	t.Setenv("EDGE_RATE_LIMIT_AUTH_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_AUTH_BURST", "")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_RPS", "")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_BURST", "")

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		authRate:    5,
		authBurst:   10,
		globalRate:  50,
		globalBurst: 100,
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}

func TestLoadRateLimitConfigReadsEnvironmentVariables(t *testing.T) {
	t.Setenv("EDGE_RATE_LIMIT_AUTH_RPS", "2.5")
	t.Setenv("EDGE_RATE_LIMIT_AUTH_BURST", "20")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_RPS", "75.5")
	t.Setenv("EDGE_RATE_LIMIT_GLOBAL_BURST", "200")

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		authRate:    2.5,
		authBurst:   20,
		globalRate:  75.5,
		globalBurst: 200,
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}
