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

// TokenSource — откуда взят токен. Cookie браузер подставляет сам — такие
// запросы надо защищать от подделки с чужих сайтов; заголовок — нет.
type TokenSource int

const (
	TokenNone TokenSource = iota
	TokenCookie
	TokenBearer
)

// SessionCookie — cookie сессии из запроса. Читаются оба имени: у сервисов
// может не быть CRANE_ENV, а имя выбирает тот, кто ставит cookie (auth).
func SessionCookie(r *http.Request) (string, bool) {
	for _, name := range []string{sessionCookieProduction, sessionCookieDevelopment} {
		if cookie, err := r.Cookie(name); err == nil && cookie.Value != "" {
			return cookie.Value, true
		}
	}
	return "", false
}

// TokenFromRequest — токен запроса: заголовок `Authorization: Bearer`, если
// он есть (его передают явно — скрипты, тесты, обмен старого токена), иначе
// cookie сессии.
func TokenFromRequest(r *http.Request) (string, TokenSource) {
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		if token := strings.TrimPrefix(header, "Bearer "); token != "" {
			return token, TokenBearer
		}
	}
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
	if err != nil || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(parsed.Host, r.Host) {
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
// не со своего сайта: такой запрос отклоняется (подделка запроса). Браузер
// всегда шлёт `Origin` с POST/PUT/PATCH/DELETE; нет его — смотрим
// `Sec-Fetch-Site`; нет и его — это не браузер, и cookie он сам не
// подставлял.
func CrossSiteCookieRequest(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	if _, ok := SessionCookie(r); !ok {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		return !OwnOrAllowedOrigin(r, origin)
	}
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
		return false
	}
	return true
}
