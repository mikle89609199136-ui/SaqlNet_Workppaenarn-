package user

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestMeRejectsUnsupportedMethodWithoutServiceCall(t *testing.T) {
	handler := NewHandler(nil, nil)
	request := httptest.NewRequest(http.MethodDelete, "/api/v2/users/me", nil)
	response := httptest.NewRecorder()

	handler.Me(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", response.Code)
	}
}

func TestUsernameReturnsCooldownWithRetryAfter(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT username\s+FROM auth\.users.*FOR UPDATE`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("old_name"))
	mock.ExpectQuery(`SELECT changed_at\s+FROM users\.username_changes`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"changed_at"}).AddRow(time.Now().Add(-time.Hour)))
	mock.ExpectRollback()

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodPut, "/api/v2/users/me/username", bytes.NewBufferString(`{"username":"new_name"}`))
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Username(response, request)

	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status 429, got %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header")
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "username_change_cooldown" {
		t.Fatalf("expected username_change_cooldown, got %q", body.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPreferenceSpecWhitelistsKnownPreferenceRoutes(t *testing.T) {
	cases := map[string]string{
		"/api/v2/users/notifications":     "notification_settings",
		"/api/v2/users/sounds":            "sound_settings",
		"/api/v2/users/advanced-settings": "advanced_settings",
	}

	for path, column := range cases {
		spec, ok := preferenceSpec(path)
		if !ok {
			t.Fatalf("expected %s to be supported", path)
		}
		if spec.column != column {
			t.Fatalf("expected %s column %s, got %s", path, column, spec.column)
		}
		if spec.key != "settings" {
			t.Fatalf("expected response key settings, got %s", spec.key)
		}
	}
}

func TestPreferenceSpecRejectsUnknownRoutes(t *testing.T) {
	if _, ok := preferenceSpec("/api/v2/users/passcode"); ok {
		t.Fatal("expected unknown preference route to be rejected")
	}
}

// TestCheckUsername_ValidationErrors verifies that the /check-username endpoint
// returns 400 Bad Request with a "validation_failed" error code for all
// malformed or invalid usernames.
//
// It uses a table-driven approach and sqlmock to ensure no database query
// is executed for invalid inputs – the validation should reject them early.
func TestCheckUsername_ValidationErrors(t *testing.T) {
	// Setup mock DB and service.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := NewService(db) // real service with mocked DB
	h := NewHandler(svc, nil)

	tests := []struct {
		name           string
		username       string // raw username (may contain special chars)
		expectedStatus int
		expectedCode   string
		expectedMsg    string
	}{
		{
			name:           "empty username",
			username:       "",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username is required",
		},
		{
			name:           "username with space",
			username:       "bad name",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "username with @",
			username:       "user@name",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "too short (2 chars)",
			username:       "ab",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "too long (63 chars)",
			username:       "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ123", // 63 chars
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "wrong name format",
			username:       "bad%20name",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "only spaces in name",
			username:       "    ",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Build request URL with properly URL-encoded username.
			u, _ := url.Parse("/api/v2/users/check-username")
			if tt.username != "" {
				q := u.Query()
				q.Set("username", tt.username)
				u.RawQuery = q.Encode()
			}
			req := httptest.NewRequest(http.MethodGet, u.String(), nil)
			w := httptest.NewRecorder()

			// Execute handler.
			h.CheckUsername(w, req)

			// Verify HTTP status.
			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			// Decode and validate JSON response.
			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if code, ok := resp["code"]; !ok || code != tt.expectedCode {
				t.Errorf("expected code %q, got %v", tt.expectedCode, code)
			}
			if msg, ok := resp["message"]; !ok || msg != tt.expectedMsg {
				t.Errorf("expected message %q, got %v", tt.expectedMsg, msg)
			}

			// Ensure no database query was attempted (since no expectations were set).
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unexpected database call: %v", err)
			}
		})
	}
}

func TestPublicStatusReturnsUserNotFound(t *testing.T) {
	const statusQueryPattern = `(?s)FROM auth\.users.*LEFT JOIN users\.settings.*LEFT JOIN users\.presence.*WHERE auth\.users\.id = \$1 AND auth\.users\.disabled_at IS NULL`

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(statusQueryPattern).
		WithArgs("11111111-1111-4111-8111-111111111111").
		WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "last_active", "is_online"}))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/11111111-1111-4111-8111-111111111111/status", nil)
	response := httptest.NewRecorder()

	handler.PublicStatus(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", response.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["code"] != "user_not_found" {
		t.Fatalf("expected user_not_found, got %v", body["code"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMalformedUUIDReturnsValidationFailedWithoutDatabaseCall(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		path    string
		body    []byte
		handler func(*Handler, http.ResponseWriter, *http.Request)
	}{
		{
			name:    "public profile",
			method:  http.MethodGet,
			path:    "/api/v2/users/not-a-uuid/profile",
			handler: (*Handler).PublicProfile,
		},
		{
			name:    "public status",
			method:  http.MethodGet,
			path:    "/api/v2/users/not-a-uuid/status",
			handler: (*Handler).PublicStatus,
		},
		{
			name:    "block user",
			method:  http.MethodPost,
			path:    "/api/v2/users/blocked",
			body:    []byte(`{"userId":"not-a-uuid"}`),
			handler: (*Handler).Blocked,
		},
		{
			name:    "unblock user",
			method:  http.MethodDelete,
			path:    "/api/v2/users/blocked/not-a-uuid",
			handler: (*Handler).Unblock,
		},
		{
			name:    "delete device",
			method:  http.MethodDelete,
			path:    "/api/v2/users/devices/not-a-uuid",
			handler: (*Handler).DeleteDevice,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			request := httptest.NewRequest(test.method, test.path, bytes.NewReader(test.body))
			request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "11111111-1111-4111-8111-111111111111"}))
			response := httptest.NewRecorder()

			test.handler(NewHandler(NewService(db), nil), response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d: %s", response.Code, response.Body.String())
			}
			var body map[string]any
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body["code"] != "validation_failed" {
				t.Fatalf("expected validation_failed, got %v", body["code"])
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unexpected database call: %v", err)
			}
		})
	}
}
