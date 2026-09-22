package main

import (
	"context"
	"craneapp/backend-v2/internal/migrations"
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
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

	if err := migrations.Run(ctx, db, "migrations"); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Println("all migrations applied")

	fmt.Println("All migrations applied successfully.")
}
