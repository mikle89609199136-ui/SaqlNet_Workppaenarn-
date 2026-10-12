//go:build integration

// Package dbtest поднимает для интеграционных тестов настоящий Postgres со
// всеми миграциями.
//
// Контейнер один на процесс тестов (то есть на пакет): поднять postgres:16
// и прогнать все миграции — секунды, и раньше это делал каждый тест. Теперь
// миграции применяются один раз в шаблонную базу, а каждый тест получает
// свою чистую копию — CREATE DATABASE … TEMPLATE, доли секунды. Тесты
// по-прежнему не видят данных друг друга.
//
// Данные в tmpfs, без fsync: тестовой базе долговечность не нужна, а
// скорость — да.
package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"sort"
	"sync"
	"testing"
	"time"

	migrationsql "craneapp/backend-v2/migrations"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const templateDB = "dbtest_template"

// server — общий контейнер и соединение с его служебной базой.
var server struct {
	once  sync.Once
	err   error
	base  string // postgres://…@host:port/ — без имени базы
	admin *sql.DB

	mu   sync.Mutex // CREATE DATABASE из шаблона — по одному
	next int
}

func start() {
	ctx := context.Background()
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:16",
			ExposedPorts: []string{"5432/tcp"},
			Env:          map[string]string{"POSTGRES_PASSWORD": "test", "POSTGRES_DB": "test"},
			Cmd:          []string{"postgres", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"},
			Tmpfs:        map[string]string{"/var/lib/postgresql/data": "rw"},
			WaitingFor: wait.ForAll(
				wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
				wait.ForListeningPort("5432/tcp"),
			).WithDeadline(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		server.err = err
		return
	}
	// Контейнер живёт до конца процесса: его убирает Ryuk testcontainers.
	host, err := container.Host(ctx)
	if err != nil {
		server.err = err
		return
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		server.err = err
		return
	}
	server.base = fmt.Sprintf("postgres://postgres:test@%s:%s/", host, port.Port())
	server.admin, err = sql.Open("postgres", server.base+"postgres?sslmode=disable")
	if err != nil {
		server.err = err
		return
	}
	server.err = migrateTemplate()
}

// migrateTemplate — шаблонная база со всеми миграциями. Соединение с ней
// закрывается: копировать можно только базу, к которой никто не подключён.
//
// Миграции — из встроенных в бинарник (migrationsql.FS), а не с диска: так
// они входят в сам тестовый бинарник, и кеш результатов go test зависит от
// их содержимого. Файлы с диска кеш сверяет по времени изменения, а оно
// после checkout в CI всегда новое — тесты не кешировались бы никогда.
func migrateTemplate() error {
	if _, err := server.admin.Exec(`CREATE DATABASE ` + templateDB); err != nil {
		return err
	}
	db, err := sql.Open("postgres", server.base+templateDB+"?sslmode=disable")
	if err != nil {
		return err
	}
	defer db.Close()

	files, err := fs.Glob(migrationsql.FS, "*.sql")
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("миграции не найдены")
	}
	sort.Strings(files)
	for _, file := range files {
		content, err := fs.ReadFile(migrationsql.FS, file)
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(content)); err != nil {
			return fmt.Errorf("%s: %w", file, err)
		}
	}
	return nil
}

// Postgres — чистая база со всеми миграциями backend-v2/migrations, своя у
// теста; удаляется по его завершении.
func Postgres(t *testing.T) *sql.DB {
	t.Helper()
	db, _ := PostgresURL(t)
	return db
}

// PostgresURL — то же, плюс адрес базы: для LISTEN и других отдельных
// соединений.
func PostgresURL(t *testing.T) (*sql.DB, string) {
	t.Helper()
	server.once.Do(start)
	require.NoError(t, server.err, "тестовый Postgres")

	server.mu.Lock()
	server.next++
	name := fmt.Sprintf("test_%d", server.next)
	_, err := server.admin.Exec(`CREATE DATABASE ` + name + ` TEMPLATE ` + templateDB)
	server.mu.Unlock()
	require.NoError(t, err)

	url := server.base + name + "?sslmode=disable"
	db, err := sql.Open("postgres", url)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = db.Close()
		// WITH (FORCE) закрывает соединения, оставленные тестом (LISTEN и т. п.).
		_, _ = server.admin.Exec(`DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`)
	})
	return db, url
}

// User заводит пользователя с таким id и именем.
func User(t *testing.T, db *sql.DB, id, username string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO auth.users (id, username, password_hash, first_name) VALUES ($1, $2, 'hash', $2)`, id, username)
	require.NoError(t, err)
}
