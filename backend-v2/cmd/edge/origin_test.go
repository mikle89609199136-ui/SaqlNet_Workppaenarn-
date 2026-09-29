package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// CORS и защита от подделки запросов перед маршрутами edge (#705).

func guarded() (http.Handler, *bool) {
	reached := false
	return originGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusNoContent)
	})), &reached
}

func TestCorsWildcardNeverAllowsCredentials(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "*")
	handler, _ := guarded()
	request := httptest.NewRequest(http.MethodGet, "https://craneapp.example/api/v2/users/me", nil)
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	// Иначе чужой сайт читал бы ответы с cookie человека.
	if got := response.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("Allow-Credentials = %q for a wildcard origin", got)
	}
}

func TestCorsExplicitOriginAllowsCredentials(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://app.example")
	handler, _ := guarded()
	request := httptest.NewRequest(http.MethodGet, "https://craneapp.example/api/v2/users/me", nil)
	request.Header.Set("Origin", "https://app.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Header().Get("Access-Control-Allow-Origin") != "https://app.example" ||
		response.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("headers = %v", response.Header())
	}
}

func TestCrossSiteRequestWithSessionCookieIsForbidden(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "*")
	handler, reached := guarded()
	request := httptest.NewRequest(http.MethodPost, "https://craneapp.example/api/v2/messages/c1", nil)
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(&http.Cookie{Name: "__Host-craneapp_session", Value: "tok"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden || *reached {
		t.Fatalf("status %d, reached %v; want 403 before the route", response.Code, *reached)
	}
}

func TestSameSiteRequestWithSessionCookiePasses(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "*")
	handler, reached := guarded()
	request := httptest.NewRequest(http.MethodPost, "https://craneapp.example/api/v2/messages/c1", nil)
	request.Header.Set("Origin", "https://craneapp.example")
	request.AddCookie(&http.Cookie{Name: "__Host-craneapp_session", Value: "tok"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent || !*reached {
		t.Fatalf("status %d, reached %v", response.Code, *reached)
	}
}
