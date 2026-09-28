package main

import (
	"testing"
)

func clearRateLimitEnvironment(t *testing.T) {
	t.Helper()

	names := []string{
		"LOGIN_REGISTER",
		"PASSWORD_2FA",
		"OTHER_AUTH",
		"MESSAGE_WRITE",
		"MESSAGE_READ",
		"MEDIA_UPLOAD",
		"OTHER_API",
		"WEBSOCKET",
		"GLOBAL",
	}

	for _, name := range names {
		t.Setenv("EDGE_RATE_LIMIT_"+name+"_RPS", "")
		t.Setenv("EDGE_RATE_LIMIT_"+name+"_BURST", "")
	}
}

func TestLoadRateLimitConfigUsesDefaults(t *testing.T) {
	clearRateLimitEnvironment(t)

	got := loadRateLimitConfig()
	want := rateLimitConfig{
		loginRegister: bucketConfig{rate: 10.0 / 60.0, burst: 5},
		password2FA:   bucketConfig{rate: 10.0 / 60.0, burst: 5},
		otherAuth:     bucketConfig{rate: 30.0 / 60.0, burst: 10},
		messageWrite:  bucketConfig{rate: 5, burst: 20},
		messageRead:   bucketConfig{rate: 20, burst: 40},
		mediaUpload:   bucketConfig{rate: 10.0 / 60.0, burst: 10},
		otherAPI:      bucketConfig{rate: 20, burst: 40},
		websocket:     bucketConfig{rate: 10.0 / 60.0, burst: 20},
		global:        bucketConfig{rate: 50, burst: 100},
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}

func TestLoadRateLimitConfigReadsEnvironmentVariables(t *testing.T) {
	clearRateLimitEnvironment(t)

	overrides := []struct {
		name  string
		rate  string
		burst string
	}{
		{name: "LOGIN_REGISTER", rate: "1.1", burst: "11"},
		{name: "PASSWORD_2FA", rate: "2.2", burst: "22"},
		{name: "OTHER_AUTH", rate: "3.3", burst: "33"},
		{name: "MESSAGE_WRITE", rate: "4.4", burst: "44"},
		{name: "MESSAGE_READ", rate: "5.5", burst: "55"},
		{name: "MEDIA_UPLOAD", rate: "6.6", burst: "66"},
		{name: "OTHER_API", rate: "7.7", burst: "77"},
		{name: "WEBSOCKET", rate: "8.8", burst: "88"},
		{name: "GLOBAL", rate: "9.9", burst: "99"},
	}

	for _, override := range overrides {
		t.Setenv("EDGE_RATE_LIMIT_"+override.name+"_RPS", override.rate)
		t.Setenv("EDGE_RATE_LIMIT_"+override.name+"_BURST", override.burst)
	}

	got := loadRateLimitConfig()

	want := rateLimitConfig{
		loginRegister: bucketConfig{rate: 1.1, burst: 11},
		password2FA:   bucketConfig{rate: 2.2, burst: 22},
		otherAuth:     bucketConfig{rate: 3.3, burst: 33},
		messageWrite:  bucketConfig{rate: 4.4, burst: 44},
		messageRead:   bucketConfig{rate: 5.5, burst: 55},
		mediaUpload:   bucketConfig{rate: 6.6, burst: 66},
		otherAPI:      bucketConfig{rate: 7.7, burst: 77},
		websocket:     bucketConfig{rate: 8.8, burst: 88},
		global:        bucketConfig{rate: 9.9, burst: 99},
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}
