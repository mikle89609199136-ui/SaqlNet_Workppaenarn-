package auth

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

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
