//go:build integration

package authctx_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/gorilla/websocket"
)

// Сессия браузера в cookie (#705) на настоящей схеме: вход ставит cookie,
// с ней работают HTTP и сокет со своего адреса, выход её стирает и отзывает
// токен — после него ни HTTP, ни сокет с той же cookie не пускают.
func TestCookieSessionOnRealSchema(t *testing.T) {
	t.Setenv("CRANE_ENV", "development")
	t.Setenv("ALLOWED_ORIGINS", "*")

	db := startRevocationPostgres(t)
	applyRevocationMigrations(t, db, revocationMigrationFiles(t))
	const userID = "22222222-2222-4222-8222-222222222222"
	if _, err := db.Exec(`
		INSERT INTO auth.users (id, username, password_hash, first_name)
		VALUES ($1, 'generation-test', 'hash', 'Cookie')
	`, userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	crypto := cryptoclient.NewClient(startIntegrationCryptoServer(t).URL)
	checker := authctx.NewDBTokenChecker(db)
	handler := auth.NewHandler(auth.NewService(db, crypto))

	// Вход — через HTTP, как у браузера: сессия приходит в Set-Cookie.
	login := httptest.NewRecorder()
	handler.Login(login, httptest.NewRequest(http.MethodPost, "/api/v2/auth/login",
		strings.NewReader(`{"username":"generation-test","password":"Password1"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login: %d %s", login.Code, login.Body.String())
	}
	var session *http.Cookie
	for _, cookie := range login.Result().Cookies() {
		if cookie.Name == authctx.SessionCookieName() {
			session = cookie
		}
	}
	if session == nil || session.Value == "" || !session.HttpOnly {
		t.Fatalf("login did not set an HttpOnly session cookie: %v", login.Result().Cookies())
	}

	protected := authenticatedIntegrationHandler(crypto, checker)
	withCookie := func(method string) *http.Request {
		request := httptest.NewRequest(method, "/protected", nil)
		request.AddCookie(&http.Cookie{Name: session.Name, Value: session.Value})
		return request
	}
	status := func(h http.Handler, r *http.Request) int {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, r)
		return response.Code
	}
	if code := status(protected, withCookie(http.MethodGet)); code != http.StatusNoContent {
		t.Fatalf("HTTP with cookie: %d", code)
	}

	wsServer := chat.NewWSServer(db, crypto, nil)
	t.Cleanup(wsServer.Close)
	wsHTTP := httptest.NewServer(http.HandlerFunc(wsServer.ServeWS))
	t.Cleanup(wsHTTP.Close)
	dial := func(origin string) int {
		header := http.Header{}
		header.Set("Cookie", session.Name+"="+session.Value)
		header.Set("Origin", origin)
		connection, response, _ := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(wsHTTP.URL, "http")+"/ws", header)
		if connection != nil {
			_ = connection.Close()
		}
		if response == nil {
			return 0
		}
		_ = response.Body.Close()
		return response.StatusCode
	}
	if code := dial(wsHTTP.URL); code != http.StatusSwitchingProtocols {
		t.Fatalf("WebSocket with cookie from own origin: %d", code)
	}
	if code := dial("https://evil.example"); code != http.StatusForbidden {
		t.Fatalf("WebSocket with cookie from foreign origin: %d, want 403", code)
	}

	// Выход по cookie: токен отозван, cookie стёрта.
	logout := httptest.NewRecorder()
	authctx.Middleware(crypto, checker)(http.HandlerFunc(handler.Logout)).ServeHTTP(logout, withCookie(http.MethodPost))
	if logout.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", logout.Code, logout.Body.String())
	}
	cleared := false
	for _, cookie := range logout.Result().Cookies() {
		cleared = cleared || (cookie.Name == session.Name && cookie.MaxAge < 0)
	}
	if !cleared {
		t.Fatalf("logout did not clear the cookie: %v", logout.Result().Cookies())
	}
	if code := status(protected, withCookie(http.MethodGet)); code != http.StatusUnauthorized {
		t.Fatalf("HTTP with cookie after logout: %d, want 401", code)
	}
	if code := dial(wsHTTP.URL); code != http.StatusUnauthorized {
		t.Fatalf("WebSocket with cookie after logout: %d, want 401", code)
	}
}
