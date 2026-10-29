package user

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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
		WithArgs("11111111-1111-4111-8111-111111111111", "").
		WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "blocked", "exceptions", "viewer_privacy", "viewer_blocks", "viewer_exceptions", "last_active", "is_online"}))

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

const (
	deleteDeviceUserID    = "11111111-1111-4111-8111-111111111111"
	deleteDeviceSessionID = "22222222-2222-4222-8222-222222222222"
	deleteDeviceSelectSQL = `SELECT access_token_hash FROM auth.sessions`
	deleteDeviceDeleteSQL = `WITH revoked AS`
)

func newDeleteDeviceRequest(t *testing.T, path string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodDelete, path, nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	return request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: deleteDeviceUserID}))
}

func decodeErrorBody(t *testing.T, response *httptest.ResponseRecorder) (code, message string) {
	t.Helper()
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v (body=%q)", err, response.Body.String())
	}
	return body.Code, body.Message
}

// TestDeleteDeviceMethodNotAllowed verifies non-DELETE methods are rejected
// with 405 before any service call. NewHandler(nil, nil) is safe because the
// method check short-circuits before the service is touched.
func TestDeleteDeviceMethodNotAllowed(t *testing.T) {
	handler := NewHandler(nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/devices/"+deleteDeviceSessionID, nil)
	response := httptest.NewRecorder()

	handler.DeleteDevice(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d: %s", response.Code, response.Body.String())
	}
	code, _ := decodeErrorBody(t, response)
	if code != "method_not_allowed" {
		t.Fatalf("expected method_not_allowed, got %q", code)
	}
}

// TestDeleteDeviceValidationErrors verifies malformed input is rejected with 400
// before reaching the service. ExpectationsWereMet() with no expectations
// asserts no database call was made.
func TestDeleteDeviceValidationErrors(t *testing.T) {
	tests := []struct {
		name         string
		path         string
		expectedCode string
		expectedMsg  string
	}{
		{
			name:         "missing session id - empty trailing segment",
			path:         "/api/v2/users/devices/",
			expectedCode: "invalid_request",
			expectedMsg:  "missing session id",
		},
		{
			name:         "not a uuid",
			path:         "/api/v2/users/devices/not-a-uuid",
			expectedCode: "validation_failed",
			expectedMsg:  "invalid sessionId",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			handler := NewHandler(NewService(db), nil)
			response := httptest.NewRecorder()

			handler.DeleteDevice(response, newDeleteDeviceRequest(t, tt.path))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
			}
			code, msg := decodeErrorBody(t, response)
			if code != tt.expectedCode {
				t.Fatalf("expected code %q, got %q", tt.expectedCode, code)
			}
			if msg != tt.expectedMsg {
				t.Fatalf("expected message %q, got %q", tt.expectedMsg, msg)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unexpected database call: %v", err)
			}
		})
	}
}

// TestDeleteDeviceNotFoundReturnsNotFound verifies sql.ErrNoRows from the
// lookup is mapped to 404 with code "not_found".
func TestDeleteDeviceNotFoundReturnsNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectDeviceRevocationCaller(mock)
	mock.ExpectQuery(deleteDeviceSelectSQL).
		WithArgs(deleteDeviceSessionID, deleteDeviceUserID, int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{"access_token_hash"}))
	mock.ExpectRollback()

	handler := NewHandler(NewService(db), nil)
	response := httptest.NewRecorder()

	handler.DeleteDevice(response, newDeleteDeviceRequest(t, "/api/v2/users/devices/"+deleteDeviceSessionID))

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
	code, _ := decodeErrorBody(t, response)
	if code != "not_found" {
		t.Fatalf("expected not_found, got %q", code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDeleteDeviceCurrentSessionReturnsConflict verifies that deleting the
// current session returns 409 with code "conflict_current_session".
// No ExpectExec is set for the DELETE statement: sqlmock will fail the test
// if the service attempts to terminate the row.
func TestDeleteDeviceCurrentSessionReturnsConflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectDeviceRevocationCaller(mock)
	mock.ExpectQuery(deleteDeviceSelectSQL).
		WithArgs(deleteDeviceSessionID, deleteDeviceUserID, int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{"access_token_hash"}).AddRow(authctx.TokenHash("caller-token")))
	mock.ExpectRollback()

	handler := NewHandler(NewService(db), nil)
	response := httptest.NewRecorder()

	handler.DeleteDevice(response, newDeleteDeviceRequest(t, "/api/v2/users/devices/"+deleteDeviceSessionID))

	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
	}
	code, msg := decodeErrorBody(t, response)
	if code != "conflict_current_session" {
		t.Fatalf("expected conflict_current_session, got %q", code)
	}
	if msg != "cannot terminate current session" {
		t.Fatalf("expected message %q, got %q", "cannot terminate current session", msg)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database call: %v", err)
	}
}

// TestDeleteDeviceUnexpectedDatabaseErrorReturns500 verifies an unexpected
// error from the lookup query is mapped to 500 internal_error.
func TestDeleteDeviceUnexpectedDatabaseErrorReturns500(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectDeviceRevocationCaller(mock)
	mock.ExpectQuery(deleteDeviceSelectSQL).
		WithArgs(deleteDeviceSessionID, deleteDeviceUserID, int64(0)).
		WillReturnError(errors.New("connection reset by peer"))
	mock.ExpectRollback()

	handler := NewHandler(NewService(db), nil)
	response := httptest.NewRecorder()

	handler.DeleteDevice(response, newDeleteDeviceRequest(t, "/api/v2/users/devices/"+deleteDeviceSessionID))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
	}
	code, msg := decodeErrorBody(t, response)
	if code != "internal_error" {
		t.Fatalf("expected internal_error, got %q", code)
	}
	if msg != "operation failed" {
		t.Fatalf("expected message %q, got %q", "operation failed", msg)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDeleteDeviceSuccessReturnsOK verifies a non-current session is deleted
// and the handler responds with 200 and {"success":true}.
func TestDeleteDeviceSuccessReturnsOK(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectDeviceRevocationCaller(mock)
	mock.ExpectQuery(deleteDeviceSelectSQL).
		WithArgs(deleteDeviceSessionID, deleteDeviceUserID, int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{"access_token_hash"}).AddRow("other-hash"))
	mock.ExpectExec(deleteDeviceDeleteSQL).
		WithArgs(deleteDeviceUserID, "other-hash").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("SELECT pg_notify").WithArgs(authctx.RevocationChannel, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	handler := NewHandler(NewService(db), nil)
	response := httptest.NewRecorder()

	handler.DeleteDevice(response, newDeleteDeviceRequest(t, "/api/v2/users/devices/"+deleteDeviceSessionID))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Success {
		t.Fatalf("expected success=true, got %v", body.Success)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDeleteDeviceDeleteExecutionErrorReturns500 verifies that when the lookup
// succeeds (is_current=false) but the DELETE itself fails, the error is mapped
// to 500 internal_error. Covers the ExecContext error branch of the service.
func TestDeleteDeviceDeleteExecutionErrorReturns500(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectDeviceRevocationCaller(mock)
	mock.ExpectQuery(deleteDeviceSelectSQL).
		WithArgs(deleteDeviceSessionID, deleteDeviceUserID, int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{"access_token_hash"}).AddRow("other-hash"))
	mock.ExpectExec(deleteDeviceDeleteSQL).
		WithArgs(deleteDeviceUserID, "other-hash").
		WillReturnError(errors.New("deadlock detected"))
	mock.ExpectRollback()

	handler := NewHandler(NewService(db), nil)
	response := httptest.NewRecorder()

	handler.DeleteDevice(response, newDeleteDeviceRequest(t, "/api/v2/users/devices/"+deleteDeviceSessionID))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
	}
	code, msg := decodeErrorBody(t, response)
	if code != "internal_error" {
		t.Fatalf("expected internal_error, got %q", code)
	}
	if msg != "operation failed" {
		t.Fatalf("expected message %q, got %q", "operation failed", msg)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func expectDeviceRevocationCaller(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT token_generation FROM auth.users").WithArgs(deleteDeviceUserID).WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(0))
	mock.ExpectQuery("SELECT EXISTS").WithArgs(deleteDeviceUserID, authctx.TokenHash("caller-token"), int64(0)).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
}

func TestDeleteDeviceRollsBackWhenNotificationFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	expectDeviceRevocationCaller(mock)
	mock.ExpectQuery(deleteDeviceSelectSQL).
		WithArgs(deleteDeviceSessionID, deleteDeviceUserID, int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{"access_token_hash"}).AddRow("other-hash"))
	mock.ExpectExec(deleteDeviceDeleteSQL).WithArgs(deleteDeviceUserID, "other-hash").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("SELECT pg_notify").WillReturnError(errors.New("notification failed"))
	mock.ExpectRollback()
	response := httptest.NewRecorder()
	NewHandler(NewService(db), nil).DeleteDevice(response, newDeleteDeviceRequest(t, "/api/v2/users/devices/"+deleteDeviceSessionID))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", response.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDecodeRejectsTrailingData(t *testing.T) {
	type payload struct {
		Theme string `json:"theme"`
	}

	cases := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{name: "valid", body: `{"theme":"dark"}`, wantOK: true},
		{name: "trailing_whitespace_nl", body: "{\"theme\":\"dark\"}\n", wantOK: true},
		{name: "trailing_whitespace_crlf", body: "{\"theme\":\"dark\"}\r\n", wantOK: true},
		{name: "trailing_whitespace_tab", body: "{\"theme\":\"dark\"}\t", wantOK: true},
		{name: "second_json", body: `{"theme":"dark"} {"ignored":true}`, wantOK: false},
		{name: "trailing_garbage", body: `{"theme":"dark"} garbage`, wantOK: false},
		{name: "trailing_null", body: `{"theme":"dark"} null`, wantOK: false},
		{name: "trailing_number", body: `{"theme":"dark"} 1`, wantOK: false},
		{name: "trailing_string", body: `{"theme":"dark"} "x"`, wantOK: false},
		{name: "trailing_array", body: `{"theme":"dark"} []`, wantOK: false},
		{name: "trailing_true", body: `{"theme":"dark"} true`, wantOK: false},
		{name: "empty_body", body: ``, wantOK: false},
		{name: "whitespace_only", body: " \n\t", wantOK: false},
		{name: "oversized", body: `{"theme":"` + strings.Repeat("a", 129<<10) + `"}`, wantOK: false},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPut, "/api/v2/users/settings", strings.NewReader(tt.body))
			rr := httptest.NewRecorder()
			var got payload
			ok := decode(rr, req, &got)
			if ok != tt.wantOK {
				t.Fatalf("decode ok=%v, want %v; status=%d body=%s", ok, tt.wantOK, rr.Code, rr.Body.String())
			}
			if !tt.wantOK {
				if rr.Code != http.StatusBadRequest {
					t.Fatalf("status=%d, want 400", rr.Code)
				}
				code, msg := decodeErrorBody(t, rr)
				if code != "invalid_json" || msg != "invalid JSON body" {
					t.Fatalf("code/msg = %q/%q", code, msg)
				}
			}
		})
	}
}

func TestBodyEndpointsRejectTrailingDataWithoutSideEffect(t *testing.T) {
	const userID = "11111111-1111-4111-8111-111111111111"
	const targetID = "22222222-2222-4222-8222-222222222222"

	cases := []struct {
		name   string
		method string
		path   string
		body   string
		call   func(h *Handler, w http.ResponseWriter, r *http.Request)
	}{
		{
			name: "put_me_decode", method: http.MethodPut, path: "/api/v2/users/me",
			body: `{"firstName":"a"} {"x":1}`,
			call: func(h *Handler, w http.ResponseWriter, r *http.Request) { h.Me(w, r) },
		},
		{
			name: "put_settings_decodeSettingsPatch", method: http.MethodPut, path: "/api/v2/users/settings",
			body: `{"theme":"trailing"} {"ignored":true}`,
			call: func(h *Handler, w http.ResponseWriter, r *http.Request) { h.Settings(w, r) },
		},
		{
			name: "put_all_settings_decodeSettingsBulkPatch", method: http.MethodPut, path: "/api/v2/users/all-settings",
			body: `{"settings":{"theme":"dark"}} {"y":2}`,
			call: func(h *Handler, w http.ResponseWriter, r *http.Request) { h.AllSettings(w, r) },
		},
		{
			name: "post_blocked_decode", method: http.MethodPost, path: "/api/v2/users/blocked",
			body: `{"userId":"` + targetID + `"} {"z":3}`,
			call: func(h *Handler, w http.ResponseWriter, r *http.Request) { h.Blocked(w, r) },
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })

			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID}))
			rr := httptest.NewRecorder()
			tt.call(NewHandler(NewService(db), nil), rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400; body=%s", rr.Code, rr.Body.String())
			}
			code, msg := decodeErrorBody(t, rr)
			if code != "invalid_json" || msg != "invalid JSON body" {
				t.Fatalf("code/msg = %q/%q", code, msg)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSettingsUnknownFieldReturnsValidationFailedNotInvalidJSON(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	req := httptest.NewRequest(
		http.MethodPut,
		"/api/v2/users/settings",
		strings.NewReader(`{"theme":"dark","unknownField":1}`),
	)
	req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{
		ID: "11111111-1111-4111-8111-111111111111",
	}))
	rr := httptest.NewRecorder()
	NewHandler(NewService(db), nil).Settings(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400; body=%s", rr.Code, rr.Body.String())
	}
	code, _ := decodeErrorBody(t, rr)
	if code != "validation_failed" {
		t.Fatalf("code=%q, want validation_failed (DisallowUnknownFields must stay off)", code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
