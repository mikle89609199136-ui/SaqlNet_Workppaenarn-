package media

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestOrphanAuditPaginationIsReadOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "2", r.URL.Query().Get("list-type"))
		require.NotEmpty(t, r.Header.Get("Authorization"))
		if r.URL.Query().Get("continuation-token") == "" {
			_, _ = w.Write([]byte(`<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>token+/</NextContinuationToken><Contents><Key>live</Key></Contents></ListBucketResult>`))
		} else {
			require.Equal(t, "token+/", r.URL.Query().Get("continuation-token"))
			_, _ = w.Write([]byte(`<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>lost</Key></Contents></ListBucketResult>`))
		}
	}))
	defer server.Close()
	mock.ExpectQuery("SELECT EXISTS").WithArgs("bucket", "live").WillReturnRows(sqlmock.NewRows([]string{"known", "live"}).AddRow(true, true))
	mock.ExpectQuery("SELECT EXISTS").WithArgs("bucket", "lost").WillReturnRows(sqlmock.NewRows([]string{"known", "live"}).AddRow(false, false))
	var result bytes.Buffer
	require.NoError(t, AuditOrphans(t.Context(), db, NewMinioStore(server.URL, "access", "secret", "region"), "bucket", &result))
	require.NotContains(t, result.String(), `"objectKey":"live"`)
	require.Contains(t, result.String(), `"objectKey":"lost"`)
	require.Contains(t, result.String(), `"status":"untracked_candidate"`)
	require.NoError(t, mock.ExpectationsWereMet())
}
