package user_test

import (
	"context"
	"craneapp/backend-v2/internal/user"
	"database/sql"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// storageMock задаёт SQL-порядок Storage: ensureSettings -> SELECT -> jsonColumn;
// при queryErr основной SELECT падает и jsonColumn уже не вызывается.
func storageMock(t *testing.T, queryErr error, messages, files, media int64) *sql.DB {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, mock.ExpectationsWereMet()); _ = db.Close() })
	mock.ExpectExec(`INSERT INTO users\.settings`).WithArgs("user-id").WillReturnResult(sqlmock.NewResult(0, 1))
	q := mock.ExpectQuery(`FROM media\.uploads u`).WithArgs("user-id")
	if queryErr != nil {
		q.WillReturnError(queryErr)
		return db
	}
	q.WillReturnRows(sqlmock.NewRows([]string{"messages", "files", "media"}).AddRow(messages, files, media))
	mock.ExpectQuery(`SELECT storage_settings FROM users\.settings`).WithArgs("user-id").WillReturnRows(sqlmock.NewRows([]string{"storage_settings"}).AddRow([]byte(`{}`)))
	return db
}

func TestStorageUsageScansQueryOrder(t *testing.T) {
	db := storageMock(t, nil, 10, 0, 12345)
	usage, _, err := user.NewService(db).Storage(context.Background(), "user-id")
	require.NoError(t, err)
	require.Equal(t, user.StorageUsage{Messages: 10, Media: 12345, Files: 0, Cache: 0}, usage)
}

func TestStorageUsageMessagesOnlyRegression(t *testing.T) {
	db := storageMock(t, nil, 10, 0, 0)
	usage, _, err := user.NewService(db).Storage(context.Background(), "user-id")
	require.NoError(t, err)
	require.Equal(t, user.StorageUsage{Messages: 10}, usage)
}

func TestStorageUsagePropagatesQueryError(t *testing.T) {
	db := storageMock(t, sql.ErrConnDone, 0, 0, 0)
	usage, _, err := user.NewService(db).Storage(context.Background(), "user-id")
	require.ErrorIs(t, err, sql.ErrConnDone)
	require.Equal(t, user.StorageUsage{}, usage)
}

// storageQuerySQL прогоняет Storage и возвращает SQL основного запроса: matcher
// sqlmock принимает любой текст, поэтому видно, что реально уходит в БД.
func storageQuerySQL(t *testing.T) string {
	t.Helper()
	var captured string
	matcher := sqlmock.QueryMatcherFunc(func(_, actual string) error {
		if strings.Contains(actual, "media.uploads") {
			captured = actual
		}
		return nil
	})
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(matcher))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, mock.ExpectationsWereMet()); _ = db.Close() })
	mock.ExpectExec(`INSERT INTO users\.settings`).WithArgs("user-id").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`FROM media\.uploads u`).WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"messages", "files", "media"}).AddRow(int64(10), int64(0), int64(0)))
	mock.ExpectQuery(`SELECT storage_settings FROM users\.settings`).WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"storage_settings"}).AddRow([]byte(`{}`)))
	_, _, err = user.NewService(db).Storage(context.Background(), "user-id")
	require.NoError(t, err)
	require.NotEmpty(t, captured, "media.uploads query captured")
	return captured
}

func TestStorageUsageQuerySplitsByApplicationPrefix(t *testing.T) {
	query := storageQuerySQL(t)
	require.Contains(t, query, "FILTER (WHERE lower(u.content_type) LIKE 'application/%')")
	require.Contains(t, query, "FILTER (WHERE lower(u.content_type) NOT LIKE 'application/%')")
	require.Contains(t, query, "COALESCE(SUM(u.size_bytes) FILTER")
	require.Contains(t, query, "::bigint AS files")
	require.Contains(t, query, "::bigint AS media")
	require.Contains(t, query, "purpose <> 'avatar'")
	require.Contains(t, query, "deleted_at IS NULL")
	idx := strings.Index(query, "FROM media.uploads")
	require.NotEqual(t, -1, idx)
	require.NotContains(t, query[idx:], "deleted_at")
}

func TestStorageUsageMessagesUsesLengthNotOctetLength(t *testing.T) {
	query := storageQuerySQL(t)
	require.Contains(t, query, "LENGTH(content)")
	require.NotContains(t, query, "OCTET_LENGTH")
}
