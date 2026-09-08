package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

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

	// Ensure migrations table exists
	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Fatalf("failed to create schema_migrations table: %v", err)
	}

	// Read migration files
	files, err := os.ReadDir("migrations")
	if err != nil {
		log.Fatalf("failed to read migrations directory: %v", err)
	}

	var migrationFiles []string
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".sql") {
			migrationFiles = append(migrationFiles, f.Name())
		}
	}
	sort.Strings(migrationFiles)

	for _, file := range migrationFiles {
		var applied bool
		err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, file).Scan(&applied)
		if err != nil {
			log.Fatalf("failed to check migration status for %s: %v", file, err)
		}

		if applied {
			fmt.Printf("Migration %s already applied, skipping.\n", file)
			continue
		}

		fmt.Printf("Applying migration %s...\n", file)
		content, err := os.ReadFile(filepath.Join("migrations", file))
		if err != nil {
			log.Fatalf("failed to read migration file %s: %v", file, err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Fatalf("failed to begin transaction: %v", err)
		}

		if _, err := tx.ExecContext(ctx, string(content)); err != nil {
			tx.Rollback()
			log.Fatalf("failed to execute migration %s: %v", file, err)
		}

		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, file); err != nil {
			tx.Rollback()
			log.Fatalf("failed to record migration %s: %v", file, err)
		}

		if err := tx.Commit(); err != nil {
			log.Fatalf("failed to commit migration %s: %v", file, err)
		}

		fmt.Printf("Migration %s applied successfully.\n", file)
	}

	fmt.Println("All migrations applied successfully.")
}
