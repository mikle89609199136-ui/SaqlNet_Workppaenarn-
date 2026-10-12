package authctx

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"craneapp/backend-v2/internal/platform/config"
)

// Сессия браузера в cookie (#705). Токен живёт в cookie, недоступной
// JavaScript (HttpOnly): скрипт на странице не может его прочитать и унести,
// и в адрес сокета он больше не попадает.
//
// В проде — `__Host-craneapp_session`: префикс заставляет браузер принять
// cookie только с Secure, Path=/ и без Domain — то есть только для этого
// хоста, не для соседних *.amvera.io. Вне прода (`http://localhost`) Secure
// невозможен — там имя без префикса.
const (
	sessionCookieProduction  = "__Host-craneapp_session"
	sessionCookieDevelopment = "craneapp_session"
	// SessionTTL — столько живёт токен (выдаёт crypto-сервис), столько и cookie.
	SessionTTL = 30 * 24 * time.Hour
)

func production() bool {
	return config.Value("CRANE_ENV", "development") == "production"
}

// SessionCookieName — имя cookie сессии в этом окружении.
func SessionCookieName() string {
	if production() {
		return sessionCookieProduction
	}
	return sessionCookieDevelopment
}

func sessionCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName(),
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   production(),
		SameSite: http.SameSiteLaxMode,
	}
}

// SetSessionCookie ставит cookie сессии с токеном.
func SetSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, sessionCookie(token, int(SessionTTL.Seconds())))
}

// ClearSessionCookie стирает cookie сессии (выход).
func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, sessionCookie("", -1))
}

// TokenSource описывает наличие cookie-сессии в запросе.
type TokenSource int

const (
	TokenNone TokenSource = iota
	TokenCookie
)

// SessionCookie — cookie сессии из запроса. Принимается только имя текущего
// окружения: в production это сохраняет гарантию __Host- против cookie,
// подброшенной соседним поддоменом.
func SessionCookie(r *http.Request) (string, bool) {
	if cookie, err := r.Cookie(SessionCookieName()); err == nil && cookie.Value != "" {
		return cookie.Value, true
	}
	return "", false
}

// HasAnySessionCookie сообщает, что запрос несёт cookie сессии одного из
// окружений. Это намеренно шире SessionCookie: edge обязан применить
// Origin-защиту, даже если его CRANE_ENV временно отличается от окружения
// сервиса, который выдал и принимает cookie. Для аутентификации по-прежнему
// принимается только имя текущего окружения.
func HasAnySessionCookie(r *http.Request) bool {
	for _, name := range []string{sessionCookieProduction, sessionCookieDevelopment} {
		if cookie, err := r.Cookie(name); err == nil && cookie.Value != "" {
			return true
		}
	}
	return false
}

// TokenFromRequest возвращает токен только из защищённой cookie-сессии.
// Bearer-аутентификация удалена после переходного выпуска #705.
func TokenFromRequest(r *http.Request) (string, TokenSource) {
	if token, ok := SessionCookie(r); ok {
		return token, TokenCookie
	}
	return "", TokenNone
}

// OwnOrAllowedOrigin — `Origin` запроса — это сам сервер или точный адрес из
// ALLOWED_ORIGINS. `"*"` здесь ничего не разрешает: для запросов с cookie
// нужен точный адрес, иначе любой сайт действовал бы от имени человека.
func OwnOrAllowedOrigin(r *http.Request, origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	requestScheme := r.URL.Scheme
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]); forwarded != "" {
		requestScheme = forwarded
	} else if requestScheme == "" && r.TLS != nil {
		requestScheme = "https"
	}
	// За TLS-терминатором scheme известен только по X-Forwarded-Proto. Если
	// прокси его не передал, всё равно безопасно сверить Host: чужой сайт не
	// может заставить браузер прислать Origin с нашим host.
	if strings.EqualFold(parsed.Host, r.Host) &&
		(requestScheme == "" || strings.EqualFold(parsed.Scheme, requestScheme)) {
		return true
	}
	for _, allowed := range strings.Split(config.Value("ALLOWED_ORIGINS", ""), ",") {
		allowed = strings.TrimSpace(allowed)
		if allowed != "" && allowed != "*" && allowed == origin {
			return true
		}
	}
	return false
}

// CrossSiteCookieRequest — запрос несёт cookie сессии, меняет данные и пришёл
// не со своего сайта: такой запрос отклоняется (подделка запроса). Для
// cookie-аутентификации Origin обязателен и должен совпасть точно; скрипты и
// другие небраузерные клиенты тоже передают свой адрес явно.
func CrossSiteCookieRequest(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	if !HasAnySessionCookie(r) {
		return false
	}
	return !OwnOrAllowedOrigin(r, r.Header.Get("Origin"))
}
