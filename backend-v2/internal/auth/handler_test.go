package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

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

func (handlerCryptoStub) IssueToken(context.Context, string, string) (string, error) {
	return "token", nil
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

func TestPublicKeysMigrationExists(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0001_auth.sql")
	if err != nil {
		t.Fatalf("read auth migration: %v", err)
	}
	if !strings.Contains(string(sql), "CREATE TABLE IF NOT EXISTS auth.public_keys") {
		t.Fatal("auth public keys migration is missing")
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
