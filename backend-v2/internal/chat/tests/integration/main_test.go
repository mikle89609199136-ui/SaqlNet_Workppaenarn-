// Package integration contains integration tests for the chat service.
//
// All tests in this package share a single PostgreSQL container, started once
// in TestMain and reused for the lifetime of the test binary. Because Go runs
// each package as its own test binary, this gives us one container per package.
package integration

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"testing"
	"time"

	"craneapp/backend-v2/internal/migrations"
	migrationsql "craneapp/backend-v2/migrations"

	_ "github.com/lib/pq"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// TestDB is the database handle shared by every test in this package.
// It is assigned exactly once in TestMain, before m.Run, and must be treated
// as read-only afterwards.
var TestDB *sql.DB

// TestMain wires up the shared PostgreSQL container, runs all tests in the
// package, and tears the container down. Any setup failure aborts the run
// with a non-zero exit code.
func TestMain(m *testing.M) {
	code, err := runTests(m)
	if err != nil {
		// Log the cause and exit non-zero. We deliberately avoid log.Fatal
		// here so that cleanup inside runTests (deferred Terminate/Close)
		// still executes on the way out.
		log.Printf("integration setup failed: %v", err)
		os.Exit(1)
	}
	os.Exit(code)
}

// runTests performs the full lifecycle of the integration test run: it starts
// the container, opens and migrates the database, invokes m.Run, and guarantees
// teardown via defers.
//
// Cleanup intentionally uses fresh contexts rather than the setup context:
// setupCtx is scoped to the 120s bootstrap window and is cancelled long before
// the tests actually finish.
func runTests(m *testing.M) (int, error) {
	setupCtx, cancelSetup := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancelSetup()

	container, err := startPostgres(setupCtx)
	if err != nil {
		return 0, err
	}
	defer terminateContainer(container)

	db, err := openAndMigrate(setupCtx, container)
	if err != nil {
		return 0, err
	}
	defer func() { _ = db.Close() }()

	tables, err := discoverTables(setupCtx, db)
	if err != nil {
		return 0, fmt.Errorf("discover tables: %w", err)
	}
	tablesToTruncate = tables

	// Publish the handle only after setup fully succeeds, so a failed run
	// never leaves a half-initialised TestDB behind.
	TestDB = db

	return m.Run(), nil
}

// startPostgres launches a disposable PostgreSQL 15 container tuned for tests.
// The returned container is owned by the caller, who is responsible for
// terminating it.
func startPostgres(ctx context.Context) (*postgres.PostgresContainer, error) {
	container, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase("testdb"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		// Block until the server reports ready; avoids flaky "connection
		// refused" errors on slower CI machines.
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		return nil, fmt.Errorf("start postgres container: %w", err)
	}
	return container, nil
}

// openAndMigrate connects to the container, configures the connection pool,
// and applies all SQL migrations from migrationsql.FS. The caller receives a
// ready-to-use *sql.DB and is responsible for closing it.
func openAndMigrate(ctx context.Context, container *postgres.PostgresContainer) (*sql.DB, error) {
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return nil, fmt.Errorf("get connection string: %w", err)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Pool settings tuned for integration tests:
	//   - 10 connections is enough for concurrency-heavy tests (each goroutine
	//     takes a connection), while keeping the load on the test container low.
	//   - idle count matches max so warm connections are never dropped between
	//     tests, avoiding reconnect latency.
	//   - lifetimes are effectively unlimited: the container lives only for the
	//     duration of the test binary, so there is nothing to expire.
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(0)
	db.SetConnMaxIdleTime(0)

	pingCtx, cancelPing := context.WithTimeout(ctx, 10*time.Second)
	defer cancelPing()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	// Migrations are compiled into the test binary via migrationsql.FS,
	// so no filesystem lookup or working-directory assumption is needed.
	if err := migrations.Run(ctx, db, migrationsql.FS, "."); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply migrations: %w", err)
	}

	return db, nil
}

// terminateContainer stops and removes the container.
//
// It deliberately uses a detached context instead of the caller's: by the time
// teardown runs, the setup context has usually been cancelled (tests can take
// far longer than the 120s bootstrap budget), which would silently turn
// Terminate into a no-op and leak the container.
func terminateContainer(container *postgres.PostgresContainer) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := container.Terminate(ctx); err != nil {
		log.Printf("terminate postgres container: %v", err)
	}
}
