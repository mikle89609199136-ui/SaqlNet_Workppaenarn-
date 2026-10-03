package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"

	"github.com/DATA-DOG/go-sqlmock"
)

type handlerCryptoStub struct {
	verifyResult bool
}

func (s handlerCryptoStub) HashPassword(context.Context, string) (string, error) {
	return "hash", nil
}

func (s handlerCryptoStub) VerifyPassword(context.Context, string, string) (bool, error) {
	return s.verifyResult, nil
}

func (handlerCryptoStub) IssueToken(context.Context, string, string, int64) (cryptoclient.IssuedToken, error) {
	return cryptoclient.IssuedToken{Token: "token", ExpiresAt: time.Unix(2_000_000_000, 0).UTC()}, nil
}

func TestRegisterRejectsInvalidInputBeforeCallingService(t *testing.T) {
	handler := NewHandler(nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/register", strings.NewReader(`{"username":"iv","password":"Password1","firstName":"Ivan"}`))
	response := httptest.NewRecorder()

	handler.Register(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", response.Code)
	}
}

func TestLoginRejectsUnsupportedMethod(t *testing.T) {
	handler := NewHandler(nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/auth/login", nil)
	response := httptest.NewRecorder()

	handler.Login(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", response.Code)
	}
}

func TestLogoutAllIsDisabledUntilRolloutIsActivated(t *testing.T) {
	handler := NewHandler(nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/logout-all", nil)
	response := httptest.NewRecorder()

	handler.LogoutAll(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d", response.Code)
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != "logout_all_unavailable" {
		t.Fatalf("expected logout_all_unavailable, got %q", body.Code)
	}
}

func TestLogoutAllCanBeActivatedAfterCompatibleRollout(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE auth.users").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(1))
	mock.ExpectExec("UPDATE auth.sessions").
		WithArgs("user-id").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectExec("UPDATE public.user_sessions").
		WithArgs("user-id").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM users.push_subscriptions").
		WithArgs("user-id").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler := NewHandler(
		NewService(db, handlerCryptoStub{}),
		WithLogoutAllGenerationEnabled(true),
	)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/logout-all", nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.LogoutAll(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPublicKeysMigrationExists(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0001_auth.sql")
	if err != nil {
		t.Fatalf("read auth migration: %v", err)
	}
	if !strings.Contains(string(sql), "CREATE TABLE IF NOT EXISTS auth.public_keys") {
		t.Fatal("auth public keys migration is missing")
	}
}

func TestTokenGenerationMigrationExists(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0025_auth_token_generation.sql")
	if err != nil {
		t.Fatalf("read token generation migration: %v", err)
	}
	if !strings.Contains(string(sql), "ADD COLUMN IF NOT EXISTS token_generation BIGINT NOT NULL DEFAULT 0") {
		t.Fatal("auth token generation migration is missing")
	}
}

func TestLoginSessionsMigrationExists(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0035_auth_login_sessions.sql")
	if err != nil {
		t.Fatalf("read login sessions migration: %v", err)
	}
	for _, fragment := range []string{
		"ALTER COLUMN refresh_token_hash DROP NOT NULL",
		"ADD COLUMN IF NOT EXISTS access_token_hash TEXT",
		"ADD COLUMN IF NOT EXISTS token_generation BIGINT NOT NULL DEFAULT 0",
		"auth_sessions_access_token_hash_key",
	} {
		if !strings.Contains(string(sql), fragment) {
			t.Fatalf("auth login sessions migration is missing %q", fragment)
		}
	}
}

func TestDeviceSessionLinkMigrationExists(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0036_auth_device_session_link.sql")
	if err != nil {
		t.Fatalf("read device session link migration: %v", err)
	}
	for _, fragment := range []string{
		"ADD COLUMN IF NOT EXISTS device_session_id UUID",
		"auth_sessions_device_session_id_fkey",
		"auth_sessions_device_session_id_key",
	} {
		if !strings.Contains(string(sql), fragment) {
			t.Fatalf("auth device session link migration is missing %q", fragment)
		}
	}
}

func TestRegisterMapsWeakPasswordToBadRequest(t *testing.T) {
	handler, mock := newPasswordMappingTestHandler(t, false)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/register", strings.NewReader(`{"username":"ivan","password":"short","firstName":"Ivan"}`))
	response := httptest.NewRecorder()

	handler.Register(response, request)

	assertWeakPasswordResponse(t, response)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestChangePasswordMapsWeakPasswordToBadRequest(t *testing.T) {
	handler, mock := newPasswordMappingTestHandler(t, true)
	mock.ExpectQuery("SELECT password_hash FROM auth.users").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"password_hash"}).AddRow("current-hash"))

	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/change-password", strings.NewReader(`{"currentPassword":"current-password","newPassword":"short"}`))
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.ChangePassword(response, request)

	assertWeakPasswordResponse(t, response)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTwoFAEnableMapsWeakPasswordToBadRequest(t *testing.T) {
	handler, mock := newPasswordMappingTestHandler(t, false)
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/2fa/enable", strings.NewReader(`{"password":"short"}`))
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.TwoFAEnable(response, request)

	assertWeakPasswordResponse(t, response)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func newPasswordMappingTestHandler(t *testing.T, verifyResult bool) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	service := NewService(db, handlerCryptoStub{verifyResult: verifyResult})
	return NewHandler(service), mock
}

func assertWeakPasswordResponse(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", response.Code)
	}

	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != "weak_password" {
		t.Errorf("expected code weak_password, got %q", body.Code)
	}
	if body.Message != "password does not meet security requirements" {
		t.Errorf("unexpected message %q", body.Message)
	}

	responseBody := response.Body.String()
	for _, detail := range []string{
		"too_short",
		"too_long",
		"whitespace_not_allowed",
		"digit_required",
		"special_required",
		"password is too short",
		"password is too long",
		"password must not contain whitespace",
		"password must contain at least one digit",
		"password must contain at least one special character",
	} {
		if strings.Contains(responseBody, detail) {
			t.Errorf("response discloses password policy detail %q", detail)
		}
	}
}
