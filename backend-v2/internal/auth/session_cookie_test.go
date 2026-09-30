package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
)

// Сессия браузера в cookie (#705): вход ставит, выход стирает.

// sessionCookieValue — значение cookie сессии в ответе; нет её — пусто.
func sessionCookieValue(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == authctx.SessionCookieName() {
			if !cookie.HttpOnly {
				t.Fatalf("session cookie is readable by JavaScript: %+v", cookie)
			}
			return cookie.Value
		}
	}
	return ""
}

func TestLoginSetsSessionCookie(t *testing.T) {
	t.Setenv("CRANE_ENV", "production")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery("SELECT u.id::text, u.username,").
		WithArgs("ivan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash", "token_generation"}).AddRow(false, nil, 0))
	mock.ExpectQuery("SELECT token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(0))

	handler := NewHandler(NewService(db, handlerCryptoStub{verifyResult: true}))
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/login",
		strings.NewReader(`{"username":"ivan","password":"Password1"}`))
	response := httptest.NewRecorder()
	handler.Login(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	if got := sessionCookieValue(t, response); got != "token" {
		t.Fatalf("session cookie = %q, want the issued token", got)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if _, exposed := body["token"]; exposed {
		t.Fatalf("login response exposes session token: %v", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Выход по cookie: отзывается токен из cookie, cookie стирается.
func TestLogoutRevokesCookieTokenAndClearsCookie(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectExec("INSERT INTO auth.revoked_tokens").
		WithArgs(tokenHash("cookie-token"), "user-id", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE public.user_sessions").
		WithArgs("user-id").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler := NewHandler(NewService(db, handlerCryptoStub{}))
	request := httptest.NewRequest(http.MethodPost, "/api/v2/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "cookie-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()
	handler.Logout(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	cleared := false
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == authctx.SessionCookieName() && cookie.Value == "" && cookie.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatalf("session cookie is not cleared: %v", response.Result().Cookies())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
