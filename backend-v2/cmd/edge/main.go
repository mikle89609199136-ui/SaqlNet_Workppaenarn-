package main

import (
	"context"
	"log"
	"math"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	openapi "craneapp/backend-v2/contracts/openapi"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"

	httpSwagger "github.com/swaggo/http-swagger"
)

const clientIPHeader = "X-Crane-Client-IP"

var mediaDownloadPath = regexp.MustCompile(`^/api/v2/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

const (
	// bucketCleanupInterval — как часто проверять карту корзин на устаревшие записи.
	bucketCleanupInterval = 5 * time.Minute
	// bucketIdleTTL — сколько корзина живёт без запросов, прежде чем её удалят.
	// Выражен через bucketCleanupInterval, а не задан отдельным числом: TTL
	// обязан быть заметно больше интервала уборки, иначе корзину потеряет
	// активный клиент и получит полный burst заново. Такая запись не даёт
	// нарушить это соотношение, поправив одно из двух чисел.
	bucketIdleTTL = 2 * bucketCleanupInterval
)

// Проверка соотношения на этапе компиляции. Если bucketIdleTTL когда-нибудь
// перестанет быть больше bucketCleanupInterval — например, кто-то заменит
// формулу выше на литерал — разность станет отрицательной, преобразование в
// uint не скомпилируется, и сборка упадёт с сообщением об этой строке.
const _ = uint(bucketIdleTTL - bucketCleanupInterval - 1)

// tokenBucket is a simple per-IP rate limiter.
type tokenBucket struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     float64 // tokens per second
	capacity float64
}

type bucket struct {
	tokens    float64
	lastRefil time.Time
}

type limiterSet struct {
	groups map[routeGroup]*tokenBucket
	global *tokenBucket
}

func newTokenBucket(rate, capacity float64) *tokenBucket {
	tb := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     rate,
		capacity: capacity,
	}
	go tb.cleanup()
	return tb
}

func newLimiterSet(cfg rateLimitConfig) *limiterSet {
	return &limiterSet{
		groups: map[routeGroup]*tokenBucket{
			routeGroupLoginRegister: newTokenBucket(cfg.loginRegister.rate, float64(cfg.loginRegister.burst)),
			routeGroupPassword2FA:   newTokenBucket(cfg.password2FA.rate, float64(cfg.password2FA.burst)),
			routeGroupOtherAuth:     newTokenBucket(cfg.otherAuth.rate, float64(cfg.otherAuth.burst)),
			routeGroupUsernameCheck: newTokenBucket(cfg.usernameCheck.rate, float64(cfg.usernameCheck.burst)),
			routeGroupMessageWrite:  newTokenBucket(cfg.messageWrite.rate, float64(cfg.messageWrite.burst)),
			routeGroupMessageRead:   newTokenBucket(cfg.messageRead.rate, float64(cfg.messageRead.burst)),
			routeGroupMediaUpload:   newTokenBucket(cfg.mediaUpload.rate, float64(cfg.mediaUpload.burst)),
			routeGroupCalls:         newTokenBucket(cfg.calls.rate, float64(cfg.calls.burst)),
			routeGroupMLS:           newTokenBucket(cfg.mls.rate, float64(cfg.mls.burst)),
			routeGroupOtherAPI:      newTokenBucket(cfg.otherAPI.rate, float64(cfg.otherAPI.burst)),
			routeGroupWebSocket:     newTokenBucket(cfg.websocket.rate, float64(cfg.websocket.burst)),
		},
		global: newTokenBucket(cfg.global.rate, float64(cfg.global.burst)),
	}
}

func (tb *tokenBucket) Allow(ip string) bool {
	return tb.allowAt(ip, time.Now())
}

func (tb *tokenBucket) allowAt(ip string, now time.Time) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	b := tb.refillBucketLocked(ip, now)
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (ls *limiterSet) AllowRequest(ip string, group routeGroup) (bool, time.Duration) {
	if group == routeGroupNone {
		ls.global.mu.Lock()
		defer ls.global.mu.Unlock()

		globalBucket := ls.global.refillBucketLocked(ip, time.Now())
		if globalBucket.tokens < 1 {
			// остаток после пополнения может быть дробным, поэтому ждать нужно
			// не целый токен, а только недостающую часть
			return false, retryAfter(globalBucket.tokens, ls.global.rate)
		}

		globalBucket.tokens--

		return true, 0
	}

	groupLimiter, exists := ls.groups[group]
	// недостижимо: newLimiterSet заводит корзину для каждой группы, гарантируется в тесте TestNewLimiterSetHasBucketForEveryRouteGroup
	if !exists {
		return false, time.Second
	}

	groupLimiter.mu.Lock()
	defer groupLimiter.mu.Unlock()

	ls.global.mu.Lock()
	defer ls.global.mu.Unlock()

	now := time.Now()
	groupBucket := groupLimiter.refillBucketLocked(ip, now)
	globalBucket := ls.global.refillBucketLocked(ip, now)

	if groupBucket.tokens < 1 || globalBucket.tokens < 1 {
		groupWait := retryAfter(groupBucket.tokens, groupLimiter.rate)
		globalWait := retryAfter(globalBucket.tokens, ls.global.rate)

		if globalWait > groupWait {
			return false, globalWait
		}

		return false, groupWait
	}

	groupBucket.tokens--
	globalBucket.tokens--

	return true, 0
}

func (tb *tokenBucket) refillBucketLocked(ip string, now time.Time) *bucket {
	b, exists := tb.buckets[ip]
	if !exists {
		b = &bucket{
			tokens:    tb.capacity,
			lastRefil: now,
		}
		tb.buckets[ip] = b
	}
	elapsed := now.Sub(b.lastRefil).Seconds()
	b.tokens = min(tb.capacity, b.tokens+elapsed*tb.rate)
	b.lastRefil = now

	return b
}

func retryAfter(tokens, rate float64) time.Duration {
	if tokens >= 1 {
		return 0
	}
	// бывает только у тестовых корзин с замороженным пополнением; защищаемся от деления на ноль
	if rate <= 0 {
		return time.Second
	}

	missingTokens := 1 - tokens
	waitSeconds := missingTokens / rate
	return time.Duration(waitSeconds * float64(time.Second))
}

// cleanup периодически удаляет корзины IP, которые давно не делали запросов,
// чтобы карта не росла бесконечно. Сам отбор устаревших корзин вынесен в
// removeStaleBuckets: расписание здесь, логика там, и логика тестируема.
func (tb *tokenBucket) cleanup() {
	ticker := time.NewTicker(bucketCleanupInterval)
	defer ticker.Stop()
	for range ticker.C {
		tb.removeStaleBuckets(time.Now(), bucketIdleTTL)
	}
}

// removeStaleBuckets удаляет корзины, которые не обновлялись дольше ttl.
// now передаётся аргументом, а не берётся из time.Now(), чтобы тест мог
// проверить отбор на фиксированном времени.
func (tb *tokenBucket) removeStaleBuckets(now time.Time, ttl time.Duration) {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	cutoff := now.Add(-ttl)
	for ip, b := range tb.buckets {
		if b.lastRefil.Before(cutoff) {
			delete(tb.buckets, ip)
		}
	}
}

func rateLimitMiddleware(trustedProxies trustedProxySet, limiters *limiterSet, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := trustedProxies.clientIP(r)
		// Заменяем любое значение от клиента адресом, определённым по политике
		// доверенных прокси, до передачи запроса внутренним сервисам. Делаем это
		// и для маршрутов вне лимита: иначе заголовок можно подделать на них.
		r.Header.Set(clientIPHeader, ip)
		if isRateLimitExempt(r.Method, r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		group := classifyRoute(r.Method, r.URL.Path)
		allowed, wait := limiters.AllowRequest(ip, group)
		if !allowed {
			retryAfterSeconds := int(math.Ceil(wait.Seconds()))
			if retryAfterSeconds < 1 {
				retryAfterSeconds = 1
			}

			w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
			httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func withoutWriteDeadline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && mediaDownloadPath.MatchString(r.URL.Path) {
			if err := httpx.DisableWriteDeadline(w); err != nil {
				log.Printf("disable media download write deadline: %v", err)
				httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func registerMediaRoutes(mux *http.ServeMux, mediaProxy http.Handler) {
	mux.Handle("/api/v2/media", mediaProxy)
	mux.Handle("/api/v2/media/", withoutWriteDeadline(mediaProxy))
}

func main() {
	_ = config.Required("ALLOWED_ORIGINS")

	trustedProxies, err := parseTrustedProxies(config.Value("TRUSTED_PROXIES", ""))
	if err != nil {
		log.Fatalf("invalid TRUSTED_PROXIES: %v", err)
	}

	authURL, err := url.Parse(config.Value("AUTH_URL", "http://127.0.0.1:8081"))
	if err != nil {
		log.Fatal(err)
	}
	authProxy := httputil.NewSingleHostReverseProxy(authURL)
	authProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("auth upstream: %v", err)
		httpx.ErrorJSON(w, r, http.StatusBadGateway, "upstream_unavailable", "auth service unavailable")
	}

	userURL, err := url.Parse(config.Value("USER_URL", "http://127.0.0.1:8082"))
	if err != nil {
		log.Fatal(err)
	}
	userProxy := httputil.NewSingleHostReverseProxy(userURL)
	userProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("user upstream: %v", err)
		httpx.ErrorJSON(w, r, http.StatusBadGateway, "upstream_unavailable", "user service unavailable")
	}

	chatURL, err := url.Parse(config.Value("CHAT_URL", "http://127.0.0.1:8083"))
	if err != nil {
		log.Fatal(err)
	}
	chatProxy := httputil.NewSingleHostReverseProxy(chatURL)
	chatProxy.FlushInterval = -1 // required for WebSocket and streaming
	chatProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("chat upstream: %v", err)
		httpx.ErrorJSON(w, r, http.StatusBadGateway, "upstream_unavailable", "chat service unavailable")
	}

	mediaURL, err := url.Parse(config.Value("MEDIA_URL", "http://127.0.0.1:8084"))
	if err != nil {
		log.Fatal(err)
	}
	mediaProxy := httputil.NewSingleHostReverseProxy(mediaURL)
	mediaProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("media upstream: %v", err)
		httpx.ErrorJSON(w, r, http.StatusBadGateway, "upstream_unavailable", "media service unavailable")
	}

	adminURL, err := url.Parse(config.Value("ADMIN_URL", "http://127.0.0.1:8085"))
	if err != nil {
		log.Fatal(err)
	}
	adminProxy := httputil.NewSingleHostReverseProxy(adminURL)
	adminProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("admin upstream: %v", err)
		httpx.ErrorJSON(w, r, http.StatusBadGateway, "upstream_unavailable", "admin service unavailable")
	}

	frontendDir := config.Value("FRONTEND_DIR", "../dist")
	// Версия выпуска (#892) — из той же сборки, что отдаётся клиентам.
	build := readBuildInfo(frontendDir)

	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok", "version": build.Version, "build": build.Build})
	})

	// API documentation. The OpenAPI contract is embedded in the edge binary.
	mux.HandleFunc("/docs/openapi.yaml", openapi.ServeSpec)
	mux.Handle("/docs/paths/", openapi.Files())
	mux.Handle("/docs/components/", openapi.Files())
	mux.Handle("/docs/", httpSwagger.Handler(
		httpSwagger.URL("/docs/openapi.yaml"),
	))

	// Auth service
	mux.Handle("/api/v2/auth/2fa/", authProxy)
	mux.Handle("/api/v2/auth/", authProxy)

	// User service (includes encryption, MLS support routes, search, stickers, gifs routed here)
	mux.Handle("/api/v2/users/", userProxy)
	mux.Handle("/api/v2/encryption/", userProxy)
	mux.Handle("/api/v2/support/", userProxy)
	mux.Handle("/api/v2/premium/", userProxy)

	// Chat service
	mux.Handle("/api/v2/chats", chatProxy)
	mux.Handle("/api/v2/chats/", chatProxy)
	mux.Handle("/api/v2/messages", chatProxy)
	mux.Handle("/api/v2/messages/", chatProxy)
	mux.Handle("/api/v2/calls/", chatProxy)
	mux.Handle("/api/v2/mls/", chatProxy)
	mux.Handle("/ws", chatProxy)

	// Media service
	registerMediaRoutes(mux, mediaProxy)

	// Admin service
	mux.Handle("/api/v2/admin/", adminProxy)
	mux.Handle("/api/v2/emojis", mediaProxy)
	mux.Handle("/api/v2/emojis/", mediaProxy)
	mux.Handle("/api/v2/gifs", mediaProxy)
	mux.Handle("/api/v2/gifs/", mediaProxy)
	mux.Handle("/api/v2/stickers", mediaProxy)
	mux.Handle("/api/v2/stickers/", mediaProxy)

	// Serve static files for frontend, fallback to index.html for React Router
	mux.Handle("/", frontendHandler(frontendDir))

	limits := loadRateLimitConfig()
	logRateLimits(limits)
	limiters := newLimiterSet(limits)

	limitedMux := rateLimitMiddleware(trustedProxies, limiters, mux)

	handler := httpx.Middleware(originGuard(limitedMux))

	server := &http.Server{Addr: edgeAddress(), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Minute, WriteTimeout: 5 * time.Minute, IdleTimeout: 120 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("CRANE_VERSION=%s build=%s", build.Version, build.Build)
		log.Printf("edge gateway listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}

func edgeAddress() string {
	if address := os.Getenv("EDGE_ADDR"); address != "" {
		return address
	}
	if port := os.Getenv("PORT"); port != "" {
		return ":" + strings.TrimPrefix(port, ":")
	}
	return ":8080"
}

// isBuildAsset — путь к файлу сборки (/assets/…): у него нет запасной
// страницы, отсутствующий — 404.
func isBuildAsset(requestPath string) bool {
	return strings.HasPrefix(requestPath, "/assets/")
}

// frontendHandler отдаёт собранный фронтенд: файлы как есть, маршруты
// приложения — index.html (React Router), неизвестные /api и /ws — 404.
func frontendHandler(frontendDir string) http.Handler {
	dir := http.Dir(frontendDir)
	files := http.FileServer(dir)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If requesting API or WS but not matched above, return 404
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws") {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "route not found")
			return
		}

		// Content-hashed assets can be cached forever; HTML must never be cached
		if isBuildAsset(r.URL.Path) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}

		file, err := dir.Open(r.URL.Path)
		if err != nil {
			// Файл сборки, которого нет (открытая вкладка просит кусок
			// прошлой версии после деплоя), — честный 404, а не страница
			// приложения с кодом 200: иначе браузер получит HTML вместо
			// скрипта, а service worker сохранит его под именем скрипта.
			if isBuildAsset(r.URL.Path) {
				w.Header().Set("Cache-Control", "no-store")
				http.NotFound(w, r)
				return
			}
			http.ServeFile(w, r, frontendFallback(frontendDir, r.URL.Path))
			return
		}
		_ = file.Close()
		files.ServeHTTP(w, r)
	})
}

func frontendFallback(frontendDir, requestPath string) string {
	if requestPath == "/mobile" || strings.HasPrefix(requestPath, "/mobile/") {
		return frontendDir + "/mobile.html"
	}
	return frontendDir + "/index.html"
}

// originGuard — CORS и защита от подделки запросов (#705) перед всеми
// маршрутами edge.
func originGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && allowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Crane-Language")
			// С credentials (cookie сессии, #705) — только точно
			// перечисленным адресам: "*" разрешает чужой Origin без них,
			// иначе любой сайт читал бы ответы от имени человека.
			if explicitlyAllowedOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		// Подделка запроса (#705): cookie сессии браузер подставляет сам,
		// поэтому меняющий данные запрос с ней — только со своего сайта.
		if authctx.CrossSiteCookieRequest(r) {
			httpx.ErrorJSON(w, r, http.StatusForbidden, "cross_site_request", "request from another site is not allowed")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// explicitlyAllowedOrigin — адрес перечислен в ALLOWED_ORIGINS точно, не "*".
func explicitlyAllowedOrigin(origin string) bool {
	for _, allowed := range strings.Split(config.Required("ALLOWED_ORIGINS"), ",") {
		if allowed = strings.TrimSpace(allowed); allowed != "*" && allowed == origin {
			return true
		}
	}
	return false
}

func allowedOrigin(origin string) bool {
	for _, allowed := range strings.Split(config.Required("ALLOWED_ORIGINS"), ",") {
		if strings.TrimSpace(allowed) == origin || allowed == "*" {
			return true
		}
	}
	return false
}
