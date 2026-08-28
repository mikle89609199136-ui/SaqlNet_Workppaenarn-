package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ApplyMigrations applies all SQL files from the specified directory to the given database.
// Files are applied in alphabetical order. It uses a table "schema_migrations" to track
// already applied files (skips them). Each migration runs in its own transaction.
// Returns an error if any operation fails (directory read, file read, SQL execution, etc.)
// The caller parameter is used for logging context.
func ApplyMigrations(ctx context.Context, db *sql.DB, migrationsDir, caller string) error {
	// Ensure migrations table exists
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %v", err)
	}
	// Read directory
	files, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("[%s] failed to read migrations directory %s: %w", caller, migrationsDir, err)
	}

	// Filter .sql files
	var migrationFiles []string
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".sql") {
			migrationFiles = append(migrationFiles, f.Name())
		}
	}

	if len(migrationFiles) == 0 {
		log.Printf("[%s] no .sql files found in %s", caller, migrationsDir)
		return nil
	}

	sort.Strings(migrationFiles)

	for _, file := range migrationFiles {
		// Check if already applied
		var applied bool
		err := db.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`,
			file,
		).Scan(&applied)
		if err != nil {
			return fmt.Errorf("[%s] failed to check migration status for %s: %w", caller, file, err)
		}
		if applied {
			log.Printf("[%s] migration %s already applied, skipping", caller, file)
			continue
		}

		// Read file content
		content, err := os.ReadFile(filepath.Join(migrationsDir, file))
		if err != nil {
			return fmt.Errorf("[%s] failed to read migration file %s: %w", caller, file, err)
		}

		// Start transaction
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("[%s] failed to begin transaction: %w", caller, err)
		}

		// Execute migration SQL
		if _, err := tx.ExecContext(ctx, string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("[%s] failed to execute migration %s: %w", caller, file, err)
		}

		// Record migration in schema_migrations
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations (version) VALUES ($1)`,
			file,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("[%s] failed to record migration %s: %w", caller, file, err)
		}

		// Commit transaction
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("[%s] failed to commit migration %s: %w", caller, file, err)
		}

		log.Printf("[%s] applied migration: %s", caller, file)
	}

	log.Printf("[%s] all migrations applied successfully (total: %d)", caller, len(migrationFiles))
	return nil
}
