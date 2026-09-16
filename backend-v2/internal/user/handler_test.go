package user

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

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
			expectedMsg:    "username - wrong format",
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
