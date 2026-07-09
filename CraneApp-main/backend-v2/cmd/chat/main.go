package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db"
	"craneapp/backend-v2/internal/platform/httpx"
	_ "github.com/lib/pq"
)

func main() {
	pool, err := db.Open(config.Required("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	crypto := cryptoclient.NewClient(config.Value("CRYPTO_URL", "http://127.0.0.1:5005"))
	wsServer := chat.NewWSServer(pool, crypto)
	handler := chat.NewHandler(chat.NewService(pool, wsServer))

	// In production NATS is required. In other environments it is optional
	// but outbox events will accumulate until NATS becomes available.
	outboxCtx, outboxCancel := context.WithCancel(context.Background())
	defer outboxCancel()
	var natsConn chat.NATSConn
	natsURL := config.Value("NATS_URL", "")
	if natsURL == "" && config.Value("CRANE_ENV", "development") == "production" {
		log.Fatal("NATS_URL is required in production (CRANE_ENV=production)")
	}
	if natsURL != "" {
		var err error
		natsConn, err = chat.DialNATS(natsURL)
		if err != nil {
			if config.Value("CRANE_ENV", "development") == "production" {
				log.Fatalf("NATS connection failed in production: %v", err)
			}
			log.Printf("NATS unavailable, outbox events will accumulate: %v", err)
		} else {
			defer natsConn.Close()
		}
	} else {
		log.Printf("NATS_URL not set — outbox events will accumulate until NATS is configured")
	}
	go chat.OutboxRelay(outboxCtx, pool, natsConn)
	authenticated := authctx.Middleware(crypto, authctx.NewDBTokenChecker(pool))
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context(), pool); err != nil {
			httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "database_unavailable", "database unavailable")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	mux.Handle("/api/v2/chats", authenticated(http.HandlerFunc(handler.List)))
	mux.Handle("/api/v2/chats/private", authenticated(http.HandlerFunc(handler.CreatePrivate)))
	mux.Handle("/api/v2/chats/groups", authenticated(http.HandlerFunc(handler.CreateGroup)))
	mux.Handle("/api/v2/chats/", authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/pins") {
			handler.Pins(w, r)
		} else {
			handler.Chat(w, r)
		}
	})))
	mux.Handle("/api/v2/messages/read", authenticated(http.HandlerFunc(handler.MessagesRead)))
	mux.Handle("/api/v2/messages/search", authenticated(http.HandlerFunc(handler.Messages)))
	mux.Handle("/api/v2/messages/favorites", authenticated(http.HandlerFunc(handler.Messages)))
	mux.Handle("/api/v2/messages/", authenticated(http.HandlerFunc(handler.Messages)))
	mux.Handle("GET /api/v2/calls/ice-servers", authenticated(http.HandlerFunc(handler.IceServers)))
	mux.Handle("GET /api/v2/calls/rooms", authenticated(http.HandlerFunc(handler.ListRooms)))
	mux.Handle("POST /api/v2/calls/rooms", authenticated(http.HandlerFunc(handler.CallRoom)))
	mux.Handle("GET /api/v2/calls/rooms/{id}", authenticated(http.HandlerFunc(handler.GetRoom)))
	mux.Handle("/api/v2/mls/keypackages", authenticated(http.HandlerFunc(handler.MLSRoutes)))
	mux.Handle("/api/v2/mls/keypackages/", authenticated(http.HandlerFunc(handler.MLSRoutes)))
	mux.Handle("/api/v2/mls/group/", authenticated(http.HandlerFunc(handler.MLSRoutes)))

	mux.HandleFunc("/ws", wsServer.ServeWS)

	server := &http.Server{Addr: config.Value("CHAT_ADDR", ":8083"), Handler: httpx.Middleware(mux), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 120 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("chat service listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
