package authctx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Cookie сессии браузера (#705): атрибуты, чтение, откуда токен.

func setCookieFrom(t *testing.T, set func(http.ResponseWriter)) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	set(rec)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %v", cookies)
	}
	return cookies[0]
}

func TestSessionCookieInProductionIsHostOnlySecureHTTPOnly(t *testing.T) {
	t.Setenv("CRANE_ENV", "production")
	cookie := setCookieFrom(t, func(w http.ResponseWriter) { SetSessionCookie(w, "tok") })

	if cookie.Name != "__Host-craneapp_session" || cookie.Value != "tok" {
		t.Fatalf("cookie = %s=%s", cookie.Name, cookie.Value)
	}
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("HttpOnly=%v Secure=%v SameSite=%v", cookie.HttpOnly, cookie.Secure, cookie.SameSite)
	}
	// __Host-: только этот хост — без Domain, путь /.
	if cookie.Path != "/" || cookie.Domain != "" {
		t.Fatalf("Path=%q Domain=%q", cookie.Path, cookie.Domain)
	}
	if cookie.MaxAge != int(SessionTTL.Seconds()) {
		t.Fatalf("MaxAge=%d", cookie.MaxAge)
	}
}

// Вне прода — http://localhost: Secure там не работает, префикс __Host- его требует.
func TestSessionCookieOutsideProductionWorksOverHTTP(t *testing.T) {
	t.Setenv("CRANE_ENV", "development")
	cookie := setCookieFrom(t, func(w http.ResponseWriter) { SetSessionCookie(w, "tok") })
	if cookie.Name != "craneapp_session" || cookie.Secure || !cookie.HttpOnly {
		t.Fatalf("cookie = %s Secure=%v HttpOnly=%v", cookie.Name, cookie.Secure, cookie.HttpOnly)
	}
}

func TestClearSessionCookieExpiresIt(t *testing.T) {
	t.Setenv("CRANE_ENV", "production")
	cookie := setCookieFrom(t, ClearSessionCookie)
	if cookie.Name != "__Host-craneapp_session" || cookie.Value != "" || cookie.MaxAge >= 0 {
		t.Fatalf("cookie = %s=%q MaxAge=%d", cookie.Name, cookie.Value, cookie.MaxAge)
	}
}

func TestTokenFromRequestPrefersExplicitBearerThenCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if _, source := TokenFromRequest(r); source != TokenNone {
		t.Fatalf("empty request: source %v", source)
	}

	// Сервис без CRANE_ENV читает cookie под любым из двух имён.
	for _, name := range []string{"__Host-craneapp_session", "craneapp_session"} {
		r = httptest.NewRequest(http.MethodGet, "/", nil)
		r.AddCookie(&http.Cookie{Name: name, Value: "from-cookie"})
		if token, source := TokenFromRequest(r); token != "from-cookie" || source != TokenCookie {
			t.Fatalf("%s: %q %v", name, token, source)
		}
	}

	// Заголовок передают явно (скрипты, обмен старого токена) — он важнее.
	r.Header.Set("Authorization", "Bearer from-header")
	if token, source := TokenFromRequest(r); token != "from-header" || source != TokenBearer {
		t.Fatalf("both: %q %v", token, source)
	}

	r = httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer ")
	if _, source := TokenFromRequest(r); source != TokenNone {
		t.Fatalf("empty bearer: source %v", source)
	}
}

func TestOwnOrAllowedOriginNeedsExactAddress(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://app.example, *")
	r := httptest.NewRequest(http.MethodPost, "https://craneapp.example/api", nil)

	cases := map[string]bool{
		"https://craneapp.example": true,  // свой адрес
		"https://app.example":      true,  // перечислен точно
		"https://evil.example":     false, // "*" для cookie ничего не разрешает
		"null":                     false,
		"":                         false,
	}
	for origin, want := range cases {
		if got := OwnOrAllowedOrigin(r, origin); got != want {
			t.Errorf("%q: %v, want %v", origin, got, want)
		}
	}
}

// Подделка запроса: меняющий данные запрос с cookie — только со своего сайта.
func TestCrossSiteCookieRequest(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "*")
	request := func(method, origin, fetchSite string, cookie bool) *http.Request {
		r := httptest.NewRequest(method, "https://craneapp.example/api/v2/messages/c1", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if fetchSite != "" {
			r.Header.Set("Sec-Fetch-Site", fetchSite)
		}
		if cookie {
			r.AddCookie(&http.Cookie{Name: "__Host-craneapp_session", Value: "tok"})
		}
		return r
	}

	cases := []struct {
		name string
		r    *http.Request
		want bool
	}{
		{"POST с cookie с чужого сайта", request(http.MethodPost, "https://evil.example", "", true), true},
		{"DELETE с cookie, чужой сайт без Origin", request(http.MethodDelete, "", "cross-site", true), true},
		{"POST с cookie с соседнего поддомена", request(http.MethodPost, "", "same-site", true), true},
		{"POST с cookie со своего сайта", request(http.MethodPost, "https://craneapp.example", "same-origin", true), false},
		{"GET с cookie с чужого сайта — не меняет данные", request(http.MethodGet, "https://evil.example", "", true), false},
		{"POST без cookie (Bearer) с чужого сайта", request(http.MethodPost, "https://evil.example", "", false), false},
		{"POST с cookie не из браузера (нет Origin и Sec-Fetch-Site)", request(http.MethodPost, "", "", true), false},
	}
	for _, c := range cases {
		if got := CrossSiteCookieRequest(c.r); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}
