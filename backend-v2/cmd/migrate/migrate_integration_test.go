//go:build integration

package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const migrationsDir = "../../migrations"

func startPostgres(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:16",
			ExposedPorts: []string{"5432/tcp"},
			Env:          map[string]string{"POSTGRES_PASSWORD": "test", "POSTGRES_DB": "test"},
			WaitingFor: wait.ForAll(
				wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
				wait.ForListeningPort("5432/tcp"),
			).WithDeadline(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("postgres host: %v", err)
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		t.Fatalf("postgres port: %v", err)
	}
	db, err := sql.Open("postgres", fmt.Sprintf("postgres://postgres:test@%s:%s/test?sslmode=disable", host, port.Port()))
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func migrationCount(t *testing.T) int {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(migrationsDir, "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("find migrations: %v (%d files)", err, len(files))
	}
	return len(files)
}

func appliedCount(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	return count
}

func mustMigrate(t *testing.T, db *sql.DB, dir string) string {
	t.Helper()
	var out bytes.Buffer
	if err := migrate(context.Background(), db, dir, &out); err != nil {
		t.Fatalf("migrate: %v\n%s", err, out.String())
	}
	return out.String()
}

// Чистая база: всё применяется один раз, повторный запуск ничего не делает.
func TestMigrateAppliesEachMigrationOnce(t *testing.T) {
	db := startPostgres(t)

	mustMigrate(t, db, migrationsDir)
	if got, want := appliedCount(t, db), migrationCount(t); got != want {
		t.Fatalf("applied %d migrations, want %d", got, want)
	}

	out := mustMigrate(t, db, migrationsDir)
	if strings.Contains(out, "Applying migration") {
		t.Fatalf("second run applied something again:\n%s", out)
	}
	if got, want := appliedCount(t, db), migrationCount(t); got != want {
		t.Fatalf("applied %d migrations after a second run, want %d", got, want)
	}
}

// Каждая миграция должна переживать повторный прогон — и на базе с данными.
// Так приходят базы, созданные до schema_migrations: при первом запуске им
// достаются все файлы. Так же прогонял всё при каждом запуске прежний
// локальный migrate. Именно здесь упала 0020 после 0025_username_changes.
func TestEveryMigrationIsSafeToReRun(t *testing.T) {
	db := startPostgres(t)
	mustMigrate(t, db, migrationsDir)

	const userID = "11111111-1111-4111-8111-111111111111"
	if _, err := db.Exec(`
		INSERT INTO auth.users (id, username, password_hash, first_name)
		VALUES ($1, 'rerun_check', 'hash', 'Rerun')
	`, userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	if _, err := db.Exec(`DELETE FROM schema_migrations`); err != nil {
		t.Fatalf("forget applied migrations: %v", err)
	}
	mustMigrate(t, db, migrationsDir)

	var username string
	if err := db.QueryRow(`SELECT username FROM auth.users WHERE id = $1`, userID).Scan(&username); err != nil {
		t.Fatalf("user after re-run: %v", err)
	}
	if username != "rerun_check" {
		t.Fatalf("re-run changed the username to %q", username)
	}
	if got, want := appliedCount(t, db), migrationCount(t); got != want {
		t.Fatalf("applied %d migrations after re-run, want %d", got, want)
	}
}

// Сломанная миграция не записывается как применённая и не оставляет
// половину изменений: следующий запуск попробует её снова.
func TestFailedMigrationIsNotRecorded(t *testing.T) {
	db := startPostgres(t)
	dir := t.TempDir()
	files := map[string]string{
		"0001_ok.sql":     `CREATE TABLE ok_table (id INT);`,
		"0002_broken.sql": `CREATE TABLE half_done (id INT); SELECT * FROM missing_table;`,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if err := migrate(context.Background(), db, dir, io.Discard); err == nil {
		t.Fatal("broken migration reported success")
	}

	var recorded []string
	rows, err := db.Query(`SELECT version FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var version string
		_ = rows.Scan(&version)
		recorded = append(recorded, version)
	}
	if len(recorded) != 1 || recorded[0] != "0001_ok.sql" {
		t.Fatalf("recorded %v, want only 0001_ok.sql", recorded)
	}
	var halfDone sql.NullString
	if err := db.QueryRow(`SELECT to_regclass('public.half_done')::text`).Scan(&halfDone); err != nil {
		t.Fatal(err)
	}
	if halfDone.Valid {
		t.Fatal("broken migration left half_done behind")
	}
}
