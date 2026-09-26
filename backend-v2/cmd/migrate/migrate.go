package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// migrate applies every .sql file in dir that is not recorded in
// schema_migrations yet, in file-name order, each in its own transaction.
//
// The same binary runs on production (docker-entrypoint.sh) and on the local
// stand (docker-compose.v2.yml), so both apply a migration exactly once.
// Migrations still have to be safe to re-run: a database created before
// schema_migrations existed gets every file on its first run. The
// integration test checks that.
func migrate(ctx context.Context, db *sql.DB, dir string, out io.Writer) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	files, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations directory: %w", err)
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
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, file).Scan(&applied); err != nil {
			return fmt.Errorf("check migration status for %s: %w", file, err)
		}
		if applied {
			_, _ = fmt.Fprintf(out, "Migration %s already applied, skipping.\n", file)
			continue
		}

		_, _ = fmt.Fprintf(out, "Applying migration %s...\n", file)
		content, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			return fmt.Errorf("read migration file %s: %w", file, err)
		}
		if err := applyMigration(ctx, db, file, string(content)); err != nil {
			return err
		}
		_, _ = fmt.Fprintf(out, "Migration %s applied successfully.\n", file)
	}

	_, _ = fmt.Fprintln(out, "All migrations applied successfully.")
	return nil
}

func applyMigration(ctx context.Context, db *sql.DB, file, content string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	if _, err := tx.ExecContext(ctx, content); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("execute migration %s: %w", file, err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, file); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record migration %s: %w", file, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %s: %w", file, err)
	}
	return nil
}
