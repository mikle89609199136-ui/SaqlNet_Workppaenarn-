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
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	openapi "craneapp/backend-v2/contracts/openapi"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"

	httpSwagger "github.com/swaggo/http-swagger"
)

type rateLimitConfig struct {
	loginRegister bucketConfig
	password2FA   bucketConfig
	otherAuth     bucketConfig
	messageWrite  bucketConfig
	messageRead   bucketConfig
	mediaUpload   bucketConfig
	otherAPI      bucketConfig
	websocket     bucketConfig
	global        bucketConfig
}

type bucketConfig struct {
	rate  float64
	burst int
}

func loadRateLimitConfig() rateLimitConfig {
	return rateLimitConfig{
		loginRegister: loadBucketConfig("LOGIN_REGISTER", 10.0/60.0, 5),
		password2FA:   loadBucketConfig("PASSWORD_2FA", 10.0/60.0, 5),
		otherAuth:     loadBucketConfig("OTHER_AUTH", 30.0/60.0, 10),
		messageWrite:  loadBucketConfig("MESSAGE_WRITE", 5, 20),
		messageRead:   loadBucketConfig("MESSAGE_READ", 20, 40),
		mediaUpload:   loadBucketConfig("MEDIA_UPLOAD", 10.0/60.0, 10),
		otherAPI:      loadBucketConfig("OTHER_API", 20, 40),
		websocket:     loadBucketConfig("WEBSOCKET", 10.0/60.0, 20),
		global:        loadBucketConfig("GLOBAL", 50, 100),
	}
}

func loadBucketConfig(name string, defaultRate float64, defaultBurst int) bucketConfig {
	prefix := "EDGE_RATE_LIMIT_" + name

	return bucketConfig{
		rate:  config.PositiveFloat64(prefix+"_RPS", defaultRate),
		burst: config.PositiveInt(prefix+"_BURST", defaultBurst),
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
			routeGroupMessageWrite:  newTokenBucket(cfg.messageWrite.rate, float64(cfg.messageWrite.burst)),
			routeGroupMessageRead:   newTokenBucket(cfg.messageRead.rate, float64(cfg.messageRead.burst)),
			routeGroupMediaUpload:   newTokenBucket(cfg.mediaUpload.rate, float64(cfg.mediaUpload.burst)),
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
		if ls.global.Allow(ip) {
			return true, 0
		}

		return false, retryAfter(0, ls.global.rate)
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

func rateLimitMiddleware(trustedProxies trustedProxySet, limiters *limiterSet, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isRateLimitExempt(r.Method, r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		ip := trustedProxies.clientIP(r)
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
	fs := http.FileServer(http.Dir(frontendDir))

	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok", "v": "csp-v3"})
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
	mux.Handle("/api/v2/media", mediaProxy)
	mux.Handle("/api/v2/media/", mediaProxy)

	// Admin service
	mux.Handle("/api/v2/admin/", adminProxy)
	mux.Handle("/api/v2/emojis", mediaProxy)
	mux.Handle("/api/v2/emojis/", mediaProxy)
	mux.Handle("/api/v2/gifs", mediaProxy)
	mux.Handle("/api/v2/gifs/", mediaProxy)
	mux.Handle("/api/v2/stickers", mediaProxy)
	mux.Handle("/api/v2/stickers/", mediaProxy)

	// Serve static files for frontend, fallback to index.html for React Router
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// If requesting API or WS but not matched above, return 404
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws") {
			httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", "route not found")
			return
		}

		// Content-hashed assets can be cached forever; HTML must never be cached
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}

		// Attempt to serve file
		if _, err := http.Dir(frontendDir).Open(r.URL.Path); err != nil {
			http.ServeFile(w, r, frontendFallback(frontendDir, r.URL.Path))
			return
		}
		fs.ServeHTTP(w, r)
	})

	limits := loadRateLimitConfig()
	limiters := newLimiterSet(limits)

	limitedMux := rateLimitMiddleware(trustedProxies, limiters, mux)

	handler := httpx.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && allowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Crane-Language")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		limitedMux.ServeHTTP(w, r)
	}))

	server := &http.Server{Addr: edgeAddress(), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Minute, WriteTimeout: 5 * time.Minute, IdleTimeout: 120 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("CRANE_BUILD_VERSION=csp-v3")
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

func frontendFallback(frontendDir, requestPath string) string {
	if requestPath == "/mobile" || strings.HasPrefix(requestPath, "/mobile/") {
		return frontendDir + "/mobile.html"
	}
	return frontendDir + "/index.html"
}

func allowedOrigin(origin string) bool {
	for _, allowed := range strings.Split(config.Required("ALLOWED_ORIGINS"), ",") {
		if strings.TrimSpace(allowed) == origin || allowed == "*" {
			return true
		}
	}
	return false
}
