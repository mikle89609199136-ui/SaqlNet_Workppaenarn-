package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

type Error struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
	Details   any    `json:"details,omitempty"`
}

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("encode response", "err", err)
	}
}

func ErrorJSON(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	JSON(w, status, Error{
		Code:      code,
		Message:   message,
		RequestID: r.Header.Get("X-Request-ID"),
	})
}

func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = time.Now().UTC().Format("20060102T150405.000000000")
			r.Header.Set("X-Request-ID", requestID)
		}
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
		w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		w.Header().Set("X-CSP-Test", "v2-unsafe-eval")
		frameAncestors := "'self'"
		for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" && origin != "*" {
				frameAncestors += " " + origin
			}
		}
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'unsafe-inline' 'unsafe-eval'; "+
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "+
				"img-src 'self' data: blob: https:; "+
				"media-src 'self' blob:; "+
				// translate.googleapis.com — «Перевести» в меню сообщения: клиент
				// ходит туда напрямую (frontend/src/services/translatorApi.ts).
				// Без него браузер блокировал запрос, и перевод не работал.
				"connect-src 'self' wss: ws: https://api.ipify.org https://translate.googleapis.com; "+
				"font-src 'self' data: https://fonts.gstatic.com; "+
				"frame-ancestors "+frameAncestors,
		)
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in handler", "method", r.Method, "path", r.URL.Path, "panic", rec)
				http.Error(w, `{"code":"internal_error","message":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
