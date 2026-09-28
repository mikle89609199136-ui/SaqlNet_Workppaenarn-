package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"
	"craneapp/backend-v2/internal/user"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestRegisterUsernameRoutesAuthenticationBoundaries(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	handler := user.NewHandler(user.NewService(database), nil)
	mux := http.NewServeMux()
	authenticatedCalls := 0
	authenticated := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authenticatedCalls++
			if r.Header.Get("Authorization") != "Bearer valid-token" {
				httpx.ErrorJSON(w, r, http.StatusUnauthorized, "missing_token", "missing or invalid token")
				return
			}
			ctx := authctx.WithUser(r.Context(), authctx.User{ID: "user-id"})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	registerUsernameRoutes(mux, authenticated, handler)
	query := regexp.QuoteMeta(`SELECT EXISTS(SELECT 1 FROM auth.username_registry WHERE username = $1)`)

	tests := []struct {
		name          string
		authorization string
	}{
		{name: "without token"},
		{name: "with valid token", authorization: "Bearer valid-token"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock.ExpectQuery(query).
				WithArgs("available_name").
				WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

			request := httptest.NewRequest(http.MethodGet, "/api/v2/users/check-username?username=available_name", nil)
			if tt.authorization != "" {
				request.Header.Set("Authorization", tt.authorization)
			}
			response := httptest.NewRecorder()

			mux.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
			}
			var body struct {
				Available bool `json:"available"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if !body.Available {
				t.Fatal("expected username to be available")
			}
		})
	}
	if authenticatedCalls != 0 {
		t.Fatalf("expected public username check to bypass authentication, got %d middleware calls", authenticatedCalls)
	}

	unauthorizedRequest := httptest.NewRequest(http.MethodGet, "/api/v2/users/search?q=alice", nil)
	unauthorizedResponse := httptest.NewRecorder()
	mux.ServeHTTP(unauthorizedResponse, unauthorizedRequest)
	if unauthorizedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("expected protected search without token to return 401, got %d", unauthorizedResponse.Code)
	}

	authorizedRequest := httptest.NewRequest(http.MethodDelete, "/api/v2/users/search?q=alice", nil)
	authorizedRequest.Header.Set("Authorization", "Bearer valid-token")
	authorizedResponse := httptest.NewRecorder()
	mux.ServeHTTP(authorizedResponse, authorizedRequest)
	if authorizedResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected authenticated search request to reach handler and return 405, got %d", authorizedResponse.Code)
	}

	renameRequest := httptest.NewRequest(http.MethodPut, "/api/v2/users/me/username", strings.NewReader(`{"username":"alice"}`))
	renameResponse := httptest.NewRecorder()
	mux.ServeHTTP(renameResponse, renameRequest)
	if renameResponse.Code != http.StatusUnauthorized {
		t.Fatalf("expected protected rename without token to return 401, got %d", renameResponse.Code)
	}
	if authenticatedCalls != 3 {
		t.Fatalf("expected authentication on all protected username requests, got %d calls", authenticatedCalls)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRegisterPublicUserRoutesValidatesUsernameWithoutToken(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mux := http.NewServeMux()
	registerUsernameRoutes(mux, func(next http.Handler) http.Handler { return next }, user.NewHandler(user.NewService(database), nil))
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/check-username?username=ab", nil)
	response := httptest.NewRecorder()

	mux.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", response.Code, response.Body.String())
	}
	var body httpx.Error
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != "validation_failed" {
		t.Fatalf("expected validation_failed, got %q", body.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

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
