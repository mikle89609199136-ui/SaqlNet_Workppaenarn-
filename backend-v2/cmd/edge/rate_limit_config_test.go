package main

import (
	"math"
	"strings"
	"testing"
)

var rateLimitGroupNames = []string{
	"LOGIN_REGISTER",
	"PASSWORD_2FA",
	"OTHER_AUTH",
	"QR_POLL",
	"USERNAME_CHECK",
	"MESSAGE_WRITE",
	"MESSAGE_READ",
	"MEDIA_UPLOAD",
	"CALLS",
	"MLS",
	"OTHER_API",
	"WEBSOCKET",
	"GLOBAL",
}

func clearRateLimitEnvironment(t *testing.T) {
	t.Helper()

	for _, name := range rateLimitGroupNames {
		t.Setenv("EDGE_RATE_LIMIT_"+name+"_RATE", "")
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
		qrPoll:        bucketConfig{rate: 2, burst: 10},
		usernameCheck: bucketConfig{rate: 2, burst: 5},
		messageWrite:  bucketConfig{rate: 5, burst: 20},
		messageRead:   bucketConfig{rate: 20, burst: 40},
		mediaUpload:   bucketConfig{rate: 1, burst: 30}, // 60/min
		calls:         bucketConfig{rate: 30.0 / 60.0, burst: 15},
		mls:           bucketConfig{rate: 5, burst: 10},
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
		{name: "LOGIN_REGISTER", rate: "60/min", burst: "11"},
		{name: "PASSWORD_2FA", rate: "120/min", burst: "22"},
		{name: "OTHER_AUTH", rate: "3/s", burst: "33"},
		{name: "QR_POLL", rate: "180/min", burst: "34"},
		{name: "USERNAME_CHECK", rate: "4/s", burst: "44"},
		{name: "MESSAGE_WRITE", rate: "5/s", burst: "55"},
		{name: "MESSAGE_READ", rate: "6/s", burst: "66"},
		{name: "MEDIA_UPLOAD", rate: "3600/h", burst: "77"},
		{name: "CALLS", rate: "7200/h", burst: "78"},
		{name: "MLS", rate: "10800/h", burst: "79"},
		{name: "OTHER_API", rate: "8/s", burst: "88"},
		{name: "WEBSOCKET", rate: "9/s", burst: "99"},
		{name: "GLOBAL", rate: "10/s", burst: "100"},
	}

	for _, override := range overrides {
		t.Setenv("EDGE_RATE_LIMIT_"+override.name+"_RATE", override.rate)
		t.Setenv("EDGE_RATE_LIMIT_"+override.name+"_BURST", override.burst)
	}

	got := loadRateLimitConfig()

	// Единицы переведены в токены в секунду: 60/min и 3600/h — это 1/s.
	want := rateLimitConfig{
		loginRegister: bucketConfig{rate: 1, burst: 11},
		password2FA:   bucketConfig{rate: 2, burst: 22},
		otherAuth:     bucketConfig{rate: 3, burst: 33},
		qrPoll:        bucketConfig{rate: 3, burst: 34},
		usernameCheck: bucketConfig{rate: 4, burst: 44},
		messageWrite:  bucketConfig{rate: 5, burst: 55},
		messageRead:   bucketConfig{rate: 6, burst: 66},
		mediaUpload:   bucketConfig{rate: 1, burst: 77},
		calls:         bucketConfig{rate: 2, burst: 78},
		mls:           bucketConfig{rate: 3, burst: 79},
		otherAPI:      bucketConfig{rate: 8, burst: 88},
		websocket:     bucketConfig{rate: 9, burst: 99},
		global:        bucketConfig{rate: 10, burst: 100},
	}

	if got != want {
		t.Fatalf("expected %+v, got %+v", want, got)
	}
}

func TestParseRateConvertsUnitsToTokensPerSecond(t *testing.T) {
	tests := []struct {
		value string
		want  float64
	}{
		{value: "1/s", want: 1},
		{value: "5/s", want: 5},
		{value: "20/sec", want: 20},
		{value: "50/second", want: 50},
		{value: "60/min", want: 1},
		{value: "30/minute", want: 0.5},
		{value: "3600/h", want: 1},
		{value: "1800/hour", want: 0.5},
		// Регистр и пробелы вокруг частей значения не должны ломать разбор:
		// в .env и в compose лишний пробел появляется слишком легко.
		{value: "5/S", want: 5},
		{value: " 60 / MIN ", want: 1},
		// Дробное значение остаётся допустимым — политику это не запрещает.
		{value: "0.5/s", want: 0.5},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			got, err := parseRate(test.value)
			if err != nil {
				t.Fatalf("parseRate(%q): unexpected error: %v", test.value, err)
			}

			if math.Abs(got-test.want) > 1e-9 {
				t.Fatalf("parseRate(%q) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}

func TestParseRateRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name        string
		value       string
		wantMessage string
	}{
		// Главный случай: голое число. Раньше оно молча означало «в секунду»,
		// из-за чего лимит можно было ослабить в 60 раз, ничего не заметив.
		{name: "bare number", value: "10", wantMessage: "has no unit"},
		{name: "empty unit", value: "10/", wantMessage: "unknown unit"},
		{name: "unknown unit", value: "10/day", wantMessage: "unknown unit"},
		{name: "rps left over from the old format", value: "10/rps", wantMessage: "unknown unit"},
		{name: "no number", value: "/s", wantMessage: "invalid number"},
		{name: "not a number", value: "many/s", wantMessage: "invalid number"},
		{name: "zero", value: "0/s", wantMessage: "positive finite"},
		{name: "negative", value: "-1/s", wantMessage: "positive finite"},
		{name: "nan", value: "NaN/s", wantMessage: "positive finite"},
		{name: "infinity", value: "Inf/s", wantMessage: "positive finite"},
		{name: "empty value", value: "", wantMessage: "has no unit"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseRate(test.value)
			if err == nil {
				t.Fatalf("parseRate(%q): expected an error, got rate %v", test.value, got)
			}

			if !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("parseRate(%q): expected the error to mention %q, got %q",
					test.value, test.wantMessage, err.Error())
			}
		})
	}
}

func TestLoadRateFallsBackToDefaultWhenUnset(t *testing.T) {
	t.Setenv("EDGE_RATE_LIMIT_TEST_RATE", "")

	if got := loadRate("EDGE_RATE_LIMIT_TEST_RATE", 7); got != 7 {
		t.Fatalf("expected the default 7, got %v", got)
	}
}

// Некорректное значение обязано остановить запуск, а не тихо превратиться в
// дефолт: иначе опечатка в настройке выглядит как работающий сервис.
func TestLoadRateStopsStartupOnInvalidValue(t *testing.T) {
	t.Setenv("EDGE_RATE_LIMIT_TEST_RATE", "10")

	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatal("expected loadRate to panic on a value without a unit")
		}

		message, ok := recovered.(string)
		if !ok {
			t.Fatalf("expected a string panic value, got %T", recovered)
		}

		// В сообщении должно быть имя переменной — иначе в логе непонятно,
		// какую именно настройку исправлять.
		if !strings.Contains(message, "EDGE_RATE_LIMIT_TEST_RATE") {
			t.Fatalf("expected the panic message to name the variable, got %q", message)
		}

		if !strings.Contains(message, "has no unit") {
			t.Fatalf("expected the panic message to explain the problem, got %q", message)
		}
	}()

	loadRate("EDGE_RATE_LIMIT_TEST_RATE", 7)
}

// Защита от рассинхронизации: группа, добавленная в классификатор, обязана
// получить и настройку. Иначе она молча получит нулевой лимит.
func TestEveryRouteGroupHasBucketConfig(t *testing.T) {
	clearRateLimitEnvironment(t)
	cfg := loadRateLimitConfig()

	for _, group := range append(allRouteGroups, routeGroupGlobal) {
		bucket := cfg.bucketFor(group)

		if bucket.rate <= 0 {
			t.Errorf("route group %q has rate %v, expected a positive rate", group, bucket.rate)
		}

		if bucket.burst <= 0 {
			t.Errorf("route group %q has burst %d, expected a positive burst", group, bucket.burst)
		}
	}
}

func TestOrderedBucketConfigsListsEveryGroupOnce(t *testing.T) {
	clearRateLimitEnvironment(t)
	entries := orderedBucketConfigs(loadRateLimitConfig())

	wantCount := len(allRouteGroups) + 1 // группы маршрутов плюс глобальная корзина
	if len(entries) != wantCount {
		t.Fatalf("expected %d entries, got %d", wantCount, len(entries))
	}

	seen := make(map[routeGroup]bool, len(entries))
	for _, entry := range entries {
		if seen[entry.group] {
			t.Errorf("route group %q listed more than once", entry.group)
		}
		seen[entry.group] = true
	}

	for _, group := range append(allRouteGroups, routeGroupGlobal) {
		if !seen[group] {
			t.Errorf("route group %q is missing from the startup log", group)
		}
	}
}
