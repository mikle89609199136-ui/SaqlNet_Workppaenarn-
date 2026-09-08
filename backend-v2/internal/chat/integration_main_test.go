// Package chat provides integration testing setup with a shared PostgreSQL container.
// This file contains TestMain and global setup for all integration tests in this package.
// All tests in this package can use the shared TestDB connection.
package chat

import (
	"context"
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"craneapp/backend-v2/pkg/migrate"
)

// TestDB is the shared database connection for all integration tests.
// It is initialized once in TestMain and reused across all test functions.
var TestDB *sql.DB

// testContainer holds the PostgreSQL container instance for cleanup.
var testContainer *postgres.PostgresContainer

// TestMain is the entry point for all tests in this package.
// It starts a PostgreSQL container, applies migrations, and then runs the tests.
// After all tests finish, the container is terminated.
func TestMain(m *testing.M) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Start PostgreSQL container
	container, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase("testdb"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		log.Fatalf("failed to start postgres container: %v", err)
	}
	testContainer = container

	// Ensure container is terminated after tests
	defer func() {
		if err := testContainer.Terminate(ctx); err != nil {
			log.Printf("failed to terminate container: %v", err)
		}
	}()

	// Obtain connection string
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		log.Fatalf("failed to get connection string: %v", err)
	}

	log.Printf("DSN: %s", dsn)

	// Open database connection
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("failed to open db: %v", err)
	}

	TestDB = db
	defer db.Close()

	// Ping the database to verify connectivity
	pingCtx, pingCancel := context.WithTimeout(ctx, 10*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		log.Fatalf("failed to ping db: %v", err)
	}
	log.Println("✅ Database ping successful")

	// Apply migrations
	// Compute the absolute path to the migrations folder using runtime.Caller.
	// The test file is located in app/internal/chat/... and migrations are in app/migrations.
	// So we need to go up two levels: internal/chat -> internal -> app, then into migrations.
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		log.Fatal("failed to get current file path")
	}
	// Assuming this file is in internal/chat, migrations are in project root/migrations
	migrationsDir := filepath.Join(filepath.Dir(filename), "..", "..", "migrations")
	if err := migrate.ApplyMigrations(ctx, db, migrationsDir, "test-suite"); err != nil {
		log.Fatalf("failed to apply migrations: %v", err)
	}
	log.Println("✅ Migrations applied")

	// Run all tests
	code := m.Run()
	os.Exit(code)
}

// CleanupAllTables truncates all tables that are modified during tests.
// This ensures isolation between test cases.
// Call this function in t.Cleanup at the end of each test.
func CleanupAllTables(ctx context.Context, db *sql.DB) error {
	// List of all tables that may contain test data.
	// Order doesn't matter because we use CASCADE.
	tables := []string{
		"auth.users",
		"chats.chats",
		"chats.members",
		"chats.user_chat_settings",
		"crypto.chat_encryption_keys",
		"messages.messages",
		"messages.reactions",
		// Add any other tables that may be affected by tests.
	}
	for _, table := range tables {
		if _, err := db.ExecContext(ctx, "TRUNCATE TABLE "+table+" CASCADE"); err != nil {
			return err
		}
	}
	return nil
}
