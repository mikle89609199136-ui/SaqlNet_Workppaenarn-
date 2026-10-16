package user

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
)

// =============================================================================
// Devices handler
// =============================================================================

// TestDevices_MethodNotAllowed verifies that a non-GET request is rejected
// with 405 and the method_not_allowed error code, without touching the
// database.
//
// The handler calls authctx.MustUser before the method check, so a user must
// be present in the request context even for the 405 path.
func TestDevices_MethodNotAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/users/devices", nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Devices(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", response.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["code"] != "method_not_allowed" {
		t.Fatalf("expected method_not_allowed, got %v", body["code"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database call: %v", err)
	}
}

// TestDevices_EmptyListSerializedAsArray verifies that when the service
// returns nil (no sessions), the handler serializes it as an empty JSON
// array rather than null.
//
// Clients that call .map() on the "devices" field would break on null, so
// this is a deliberate contract of the API.
func TestDevices_EmptyListSerializedAsArray(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "device_name", "device_type", "ip_address", "last_active", "created_at",
			"location", "user_agent", "is_current",
		}))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/devices", nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Devices(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}

	raw := strings.TrimSpace(response.Body.String())
	if strings.Contains(raw, `"devices":null`) {
		t.Fatalf("devices must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"devices":[]`) {
		t.Fatalf("expected devices to be an empty JSON array; got: %s", raw)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDevices_ReturnsList verifies the happy path: a session returned by
// the service is serialized into the "devices" array with the expected
// JSON field names.
func TestDevices_ReturnsList(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{
		"id", "device_name", "device_type", "ip_address", "last_active", "created_at",
		"location", "user_agent", "is_current",
	}).AddRow("session-1", "Device One", "desktop", "IP A",
		time.Date(2026, 10, 16, 10, 0, 0, 0, time.UTC), time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC),
		"Unknown", "audit-agent-1", true)

	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).
		WillReturnRows(rows)

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/devices", nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Devices(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}

	var body struct {
		Devices []struct {
			ID         string `json:"id"`
			DeviceName string `json:"deviceName"`
			DeviceType string `json:"deviceType"`
			IPAddress  string `json:"ipAddress"`
			UserAgent  string `json:"userAgent"`
			IsCurrent  bool   `json:"isCurrent"`
		} `json:"devices"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(body.Devices))
	}
	d := body.Devices[0]
	if d.ID != "session-1" || d.DeviceName != "Device One" ||
		d.DeviceType != "desktop" || d.IPAddress != "IP A" ||
		d.UserAgent != "audit-agent-1" || !d.IsCurrent {
		t.Fatalf("unexpected device payload: %+v", d)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDevices_ServiceError verifies that a service failure results in a 500
// response with the internal_error code.
func TestDevices_ServiceError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).
		WillReturnError(errors.New("boom"))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/devices", nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Devices(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d: %s", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["code"] != "internal_error" {
		t.Fatalf("expected internal_error, got %v", body["code"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// =============================================================================
// RegisterDevice handler
// =============================================================================

// TestRegisterDevice_MethodNotAllowed verifies that a non-POST request is
// rejected with 405 before any service or DB call happens.
//
// Unlike Devices, the RegisterDevice handler checks the method first, so no
// user context is required for this path.
func TestRegisterDevice_MethodNotAllowed(t *testing.T) {
	handler := NewHandler(nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/devices", nil)
	response := httptest.NewRecorder()

	handler.RegisterDevice(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", response.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["code"] != "method_not_allowed" {
		t.Fatalf("expected method_not_allowed, got %v", body["code"])
	}
}

// TestRegisterDevice_Success verifies the happy path: a valid POST body is
// forwarded to the service and the returned session id is serialized into
// the response.
func TestRegisterDevice_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`UPDATE auth\.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token"), "Device One", "desktop", "IP A", "Unknown", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))

	handler := NewHandler(NewService(db), nil)
	body := bytes.NewBufferString(`{
		"deviceName": "Device One",
		"deviceType": "desktop",
		"userAgent":  "audit-agent-1",
		"clientIP":   "IP A"
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/users/devices", body)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.RegisterDevice(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Success   bool   `json:"success"`
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Success || payload.SessionID != "session-1" {
		t.Fatalf("unexpected payload: %+v", payload)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_ServiceError_Returns500 verifies that a non-auth
// service error results in a 500 response with the internal_error code.
func TestRegisterDevice_ServiceError_Returns500(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Metadata update fails; the service returns a generic error.
	mock.ExpectQuery(`UPDATE auth\.sessions s`).WillReturnError(errors.New("boom"))

	handler := NewHandler(NewService(db), nil)
	body := bytes.NewBufferString(`{
		"deviceName": "Device One",
		"deviceType": "desktop",
		"userAgent":  "audit-agent-1",
		"clientIP":   "IP A"
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/users/devices", body)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.RegisterDevice(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d: %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["code"] != "internal_error" {
		t.Fatalf("expected internal_error, got %v", payload["code"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_InvalidBody_Returns400 verifies that a malformed JSON
// body is rejected with 400 before any service call, and that no DB
// expectations are consumed.
func TestRegisterDevice_InvalidBody_Returns400(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	handler := NewHandler(NewService(db), nil)
	body := bytes.NewBufferString(`{not valid json`)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/users/devices", body)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.RegisterDevice(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database call: %v", err)
	}
}
