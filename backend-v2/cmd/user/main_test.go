package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/user"
)

func TestRegisterSignalRoutesMakesEndpointsReachable(t *testing.T) {
	mux := http.NewServeMux()
	handler := user.NewHandler(nil, nil)
	authenticatedCalls := 0
	authenticated := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authenticatedCalls++
			ctx := authctx.WithUser(r.Context(), authctx.User{ID: "user-id"})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	registerSignalRoutes(mux, authenticated, handler)

	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{name: "keys", method: http.MethodPost, path: "/api/v2/encryption/signal/keys", body: "{", wantStatus: http.StatusBadRequest, wantCode: "invalid_json"},
		{name: "bundle", method: http.MethodGet, path: "/api/v2/encryption/signal/bundle/", wantStatus: http.StatusBadRequest, wantCode: "missing_user_id"},
		{name: "prekeys", method: http.MethodPost, path: "/api/v2/encryption/signal/prekeys", body: "{", wantStatus: http.StatusBadRequest, wantCode: "invalid_json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			response := httptest.NewRecorder()

			mux.ServeHTTP(response, request)

			if response.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tt.wantStatus, response.Code, response.Body.String())
			}
			var body httpx.Error
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != tt.wantCode {
				t.Fatalf("expected code %q, got %q", tt.wantCode, body.Code)
			}
		})
	}

	if authenticatedCalls != len(tests) {
		t.Fatalf("expected authentication middleware on all routes, got %d calls", authenticatedCalls)
	}
}
