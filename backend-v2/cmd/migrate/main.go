package main

import (
	"context"
	"database/sql"
	"log"
	"os"

	_ "github.com/lib/pq"

	"craneapp/backend-v2/pkg/migrate"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}

	ctx := context.Background()

	// ============================================================================
	// Applying database migrations
	// ============================================================================
	//
	// Parameters:
	//   - ctx
	//   - db: a fully initialised *sql.DB connection pool to the target database.
	//   - "migrations": the relative path to the folder containing the SQL files.
	//   - "migrate-service": a human-readable identifier that is included in log
	//     messages to trace the source of migration calls.
	err = migrate.ApplyMigrations(ctx, db, "migrations", "migrate-service")
	if err != nil {
		log.Fatalf("migrations failed: %v", err)
	}

}
