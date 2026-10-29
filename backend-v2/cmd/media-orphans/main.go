// media-orphans emits a dry-run inventory only; it cannot enqueue or delete objects.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"craneapp/backend-v2/internal/media"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/db"
)

func main() {
	pool, err := db.Open(config.Required("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	store := media.NewMinioStore(config.Required("MINIO_ENDPOINT"), config.Required("MINIO_ACCESS_KEY"), config.Required("MINIO_SECRET_KEY"), config.Value("MINIO_REGION", "us-east-1"))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := media.AuditOrphans(ctx, pool, store, config.Required("MEDIA_BUCKET"), os.Stdout); err != nil {
		log.Fatal(err)
	}
}
