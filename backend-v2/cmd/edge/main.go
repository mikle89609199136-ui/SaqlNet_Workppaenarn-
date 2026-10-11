package main

import (
	"context"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
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

type rateLimitConfig struct {
	authRate           float64
	authBurst          int
	usernameCheckRate  float64
	usernameCheckBurst int
	mediaDownloadRate  float64
	mediaDownloadBurst int
	globalRate         float64
	globalBurst        int
}

const clientIPHeader = "X-Crane-Client-IP"

var mediaDownloadPath = regexp.MustCompile(`^/api/v2/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func loadRateLimitConfig() rateLimitConfig {
	return rateLimitConfig{
		authRate:           config.PositiveFloat64("EDGE_RATE_LIMIT_AUTH_RPS", 5),
		authBurst:          config.PositiveInt("EDGE_RATE_LIMIT_AUTH_BURST", 10),
		usernameCheckRate:  config.PositiveFloat64("EDGE_RATE_LIMIT_USERNAME_CHECK_RPS", 2),
		usernameCheckBurst: config.PositiveInt("EDGE_RATE_LIMIT_USERNAME_CHECK_BURST", 5),
		mediaDownloadRate:  config.PositiveFloat64("EDGE_RATE_LIMIT_MEDIA_DOWNLOAD_RPS", 20),
		mediaDownloadBurst: config.PositiveInt("EDGE_RATE_LIMIT_MEDIA_DOWNLOAD_BURST", 60),
		globalRate:         config.PositiveFloat64("EDGE_RATE_LIMIT_GLOBAL_RPS", 50),
		globalBurst:        config.PositiveInt("EDGE_RATE_LIMIT_GLOBAL_BURST", 100),
	}
}

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

func newTokenBucket(rate, capacity float64) *tokenBucket {
	tb := &tokenBucket{
		buckets:  make(map[string]*bucket),
		rate:     rate,
		capacity: capacity,
	}
	go tb.cleanup()
	return tb
}

func (tb *tokenBucket) Allow(ip string) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	now := time.Now()
	b, ok := tb.buckets[ip]
	if !ok {
		b = &bucket{tokens: tb.capacity, lastRefil: now}
		tb.buckets[ip] = b
	}
	elapsed := now.Sub(b.lastRefil).Seconds()
	b.tokens = min(tb.capacity, b.tokens+elapsed*tb.rate)
	b.lastRefil = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (tb *tokenBucket) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		tb.mu.Lock()
		cutoff := time.Now().Add(-10 * time.Minute)
		for ip, b := range tb.buckets {
			if b.lastRefil.Before(cutoff) {
				delete(tb.buckets, ip)
			}
		}
		tb.mu.Unlock()
	}
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func rateLimitMiddleware(trustedProxies trustedProxySet, authLimiter, usernameCheckLimiter, mediaDownloadLimiter, globalLimiter *tokenBucket, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := trustedProxies.clientIP(r)
		// Replace any client-supplied value with the address resolved from the
		// trusted-proxy policy before forwarding the request to internal services.
		r.Header.Set(clientIPHeader, ip)
		// Stricter limit for auth endpoints (login/register brute-force).
		if strings.HasPrefix(r.URL.Path, "/api/v2/auth/") {
			if !authLimiter.Allow(ip) {
				httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests — slow down")
				return
			}
		}
		if r.URL.Path == "/api/v2/users/check-username" && !usernameCheckLimiter.Allow(ip) {
			httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many username checks — slow down")
			return
		}
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && mediaDownloadPath.MatchString(r.URL.Path) && !mediaDownloadLimiter.Allow(ip) {
			httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many media downloads — slow down")
			return
		}
		if !globalLimiter.Allow(ip) {
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

	// Rate limits use safe defaults and can be overridden through environment variables.
	limits := loadRateLimitConfig()
	authLimiter := newTokenBucket(limits.authRate, float64(limits.authBurst))
	usernameCheckLimiter := newTokenBucket(limits.usernameCheckRate, float64(limits.usernameCheckBurst))
	mediaDownloadLimiter := newTokenBucket(limits.mediaDownloadRate, float64(limits.mediaDownloadBurst))
	globalLimiter := newTokenBucket(limits.globalRate, float64(limits.globalBurst))
	limitedMux := rateLimitMiddleware(trustedProxies, authLimiter, usernameCheckLimiter, mediaDownloadLimiter, globalLimiter, mux)

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
