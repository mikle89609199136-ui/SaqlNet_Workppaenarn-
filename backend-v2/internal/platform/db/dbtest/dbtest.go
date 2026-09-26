//go:build integration

// Package dbtest поднимает для интеграционных тестов настоящий Postgres со
// всеми миграциями.
package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// Postgres запускает postgres:16, применяет backend-v2/migrations по порядку
// и возвращает соединение. Контейнер удаляется по завершении теста.
func Postgres(t *testing.T) *sql.DB {
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
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	host, err := container.Host(ctx)
	require.NoError(t, err)
	port, err := container.MappedPort(ctx, "5432")
	require.NoError(t, err)
	db, err := sql.Open("postgres", fmt.Sprintf("postgres://postgres:test@%s:%s/test?sslmode=disable", host, port.Port()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	_, self, _, _ := runtime.Caller(0)
	files, err := filepath.Glob(filepath.Join(filepath.Dir(self), "..", "..", "..", "..", "migrations", "*.sql"))
	require.NoError(t, err)
	require.NotEmpty(t, files, "миграции не найдены")
	sort.Strings(files)
	for _, file := range files {
		content, err := os.ReadFile(file)
		require.NoError(t, err)
		_, err = db.Exec(string(content))
		require.NoError(t, err, file)
	}
	return db
}

// User заводит пользователя с таким id и именем.
func User(t *testing.T, db *sql.DB, id, username string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO auth.users (id, username, password_hash, first_name) VALUES ($1, $2, 'hash', $2)`, id, username)
	require.NoError(t, err)
}
