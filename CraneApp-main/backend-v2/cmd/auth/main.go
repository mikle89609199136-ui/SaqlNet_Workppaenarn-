package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"craneapp/backend-v2/internal/auth"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/httpx"
	_ "github.com/lib/pq"
)

func main() {
	db, err := sql.Open("postgres", config.Required("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)

	crypto := cryptoclient.NewClient(config.Value("CRYPTO_URL", "http://127.0.0.1:5005"))
	svc := auth.NewService(db, crypto)
	handler := auth.NewHandler(svc)
	authenticated := authctx.Middleware(crypto, svc)
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "database_unavailable", "database unavailable")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("/api/v2/auth/register", handler.Register)
	mux.HandleFunc("/api/v2/auth/login", handler.Login)
	mux.HandleFunc("/api/v2/auth/qr-token", handler.QRToken)
	mux.HandleFunc("/api/v2/auth/qr-status/{token}", handler.QRStatus)
	mux.Handle("/api/v2/auth/qr-confirm", authenticated(http.HandlerFunc(handler.QRConfirm)))
	mux.Handle("/api/v2/auth/public-key", authenticated(http.HandlerFunc(handler.PublicKey)))
	mux.Handle("/api/v2/auth/logout", authenticated(http.HandlerFunc(handler.Logout)))
	mux.Handle("/api/v2/auth/logout-all", authenticated(http.HandlerFunc(handler.LogoutAll)))
	mux.Handle("/api/v2/auth/sessions", authenticated(http.HandlerFunc(handler.Sessions)))
	mux.Handle("/api/v2/auth/change-password", authenticated(http.HandlerFunc(handler.ChangePassword)))
	mux.Handle("/api/v2/auth/2fa/status", authenticated(http.HandlerFunc(handler.TwoFAStatus)))
	mux.Handle("/api/v2/auth/2fa/enable", authenticated(http.HandlerFunc(handler.TwoFAEnable)))
	mux.Handle("/api/v2/auth/2fa/disable", authenticated(http.HandlerFunc(handler.TwoFADisable)))
	mux.Handle("/api/v2/auth/2fa/verify", authenticated(http.HandlerFunc(handler.TwoFAVerify)))

	server := &http.Server{Addr: config.Value("AUTH_ADDR", ":8081"), Handler: httpx.Middleware(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("auth service listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
