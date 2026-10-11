package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"craneapp/backend-v2/internal/media"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"craneapp/backend-v2/internal/platform/db"
	"craneapp/backend-v2/internal/platform/httpx"
	_ "github.com/lib/pq"
)

const minioEnsureRetries = 10
const minioEnsureRetryDelay = 2 * time.Second

func main() {
	maxFileSize := config.RequiredPositiveInt64("MAX_FILE_SIZE")

	pool, err := db.Open(config.Required("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	// In production, refuse to start with default dev credentials.
	minioSecret := config.Value("MINIO_SECRET_KEY", "craneapp-local-secret")
	if config.Value("CRANE_ENV", "development") == "production" && minioSecret == "craneapp-local-secret" {
		log.Fatal("MINIO_SECRET_KEY must be set to a non-default value in production")
	}

	minioEndpoint := config.Value("MINIO_ENDPOINT", "http://127.0.0.1:9000")
	store := media.NewMinioStore(
		minioEndpoint,
		config.Value("MINIO_ACCESS_KEY", "craneapp"),
		minioSecret,
		config.Value("MINIO_REGION", "us-east-1"),
	)
	bucket := config.Value("MEDIA_BUCKET", "crane-media")

	// Ensure the bucket exists before accepting uploads.
	// Retry because MinIO may still be starting up when the media service starts.
	initCtx, cancel := context.WithTimeout(context.Background(), time.Duration(minioEnsureRetries)*minioEnsureRetryDelay+5*time.Second)
	defer cancel()

	var ensureErr error
	for i := 0; i < minioEnsureRetries; i++ {
		if i > 0 {
			log.Printf("media: retrying bucket ensure %q (%d/%d) after error: %v", bucket, i+1, minioEnsureRetries, ensureErr)
			time.Sleep(minioEnsureRetryDelay)
		}
		ensureErr = store.EnsureBucket(initCtx, bucket)
		if ensureErr == nil {
			log.Printf("media: bucket %q ensured", bucket)
			break
		}
	}
	if ensureErr != nil {
		log.Fatalf("media: failed to ensure bucket %q after %d retries: %v", bucket, minioEnsureRetries, ensureErr)
	}
	backfillCtx, backfillCancel := context.WithTimeout(context.Background(), 30*time.Second)
	backfillErr := media.BackfillStickerStorageIdentities(backfillCtx, pool, minioEndpoint, bucket)
	backfillCancel()
	if backfillErr != nil {
		log.Fatalf("media: backfill sticker storage identities: %v", backfillErr)
	}

	svc := media.NewService(pool, store, bucket, maxFileSize)
	handler := media.NewHandler(svc)

	crypto := cryptoclient.NewClient(config.Value("CRYPTO_URL", "http://127.0.0.1:5005"))
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
		if err := authctx.CheckTokenGenerationSchema(r.Context(), pool); err != nil {
			httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "schema_not_ready", "required database migration is not applied")
			return
		}
		if err := crypto.CheckTokenGenerationSupport(r.Context()); err != nil {
			httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_protocol_not_ready", "crypto token-generation protocol is not ready")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	mux.Handle("/api/v2/media", authenticated(http.HandlerFunc(handler.Upload)))
	mux.Handle("/api/v2/media/", authenticated(http.HandlerFunc(handler.Serve)))

	mux.Handle("/api/v2/emojis", http.HandlerFunc(media.ServeEmojis))
	mux.Handle("/api/v2/gifs", authenticated(http.HandlerFunc(handler.HandleGifsRoutes)))
	mux.Handle("/api/v2/gifs/", authenticated(http.HandlerFunc(handler.HandleGifsRoutes)))
	mux.Handle("/api/v2/stickers/packs", authenticated(http.HandlerFunc(handler.HandleStickersRoutes)))
	mux.Handle("/api/v2/stickers/packs/", authenticated(http.HandlerFunc(handler.HandleStickersRoutes)))
	mux.Handle("/api/v2/stickers/", authenticated(http.HandlerFunc(handler.HandleStickersRoutes)))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	cleanupWorker := media.NewCleanupWorker(pool, store)
	go cleanupWorker.Run(ctx)

	server := &http.Server{Addr: config.Value("MEDIA_ADDR", ":8084"), Handler: httpx.Middleware(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Minute, WriteTimeout: 5 * time.Minute, IdleTimeout: 120 * time.Second}
	go func() {
		log.Printf("media service listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
