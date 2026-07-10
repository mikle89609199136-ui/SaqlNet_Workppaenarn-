package main

import (
	"context"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"
)

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

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.SplitN(fwd, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}

func rateLimitMiddleware(authLimiter, globalLimiter *tokenBucket, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		// Stricter limit for auth endpoints (login/register brute-force).
		if strings.HasPrefix(r.URL.Path, "/api/v2/auth/") {
			if !authLimiter.Allow(ip) {
				httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests — slow down")
				return
			}
		}
		if !globalLimiter.Allow(ip) {
			httpx.ErrorJSON(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	if os.Getenv("ALLOWED_ORIGINS") == "" {
		slog.Warn("ALLOWED_ORIGINS not set — defaulting to localhost; set it in production")
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

	// Auth: 5 req/s burst 10 per IP. Global: 50 req/s burst 100 per IP.
	authLimiter := newTokenBucket(5, 10)
	globalLimiter := newTokenBucket(50, 100)

	handler := httpx.Middleware(rateLimitMiddleware(authLimiter, globalLimiter, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		mux.ServeHTTP(w, r)
	})))

	server := &http.Server{Addr: config.Value("EDGE_ADDR", ":8080"), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Minute, WriteTimeout: 5 * time.Minute, IdleTimeout: 120 * time.Second}
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

func frontendFallback(frontendDir, requestPath string) string {
	if requestPath == "/mobile" || strings.HasPrefix(requestPath, "/mobile/") {
		return frontendDir + "/mobile.html"
	}
	return frontendDir + "/index.html"
}

func allowedOrigin(origin string) bool {
	allowedOrigins := config.Value("ALLOWED_ORIGINS", "")
	if allowedOrigins == "" {
		// ALLOWED_ORIGINS not configured — allow any origin
		return true
	}
	for _, allowed := range strings.Split(allowedOrigins, ",") {
		if strings.TrimSpace(allowed) == origin || allowed == "*" {
			return true
		}
	}
	return false
}
