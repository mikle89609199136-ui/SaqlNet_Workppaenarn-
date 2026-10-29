package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestPublicKeyErrorsAreSafe(t *testing.T) {
	for _, tc := range []struct {
		name          string
		setup         func(sqlmock.Sqlmock)
		key           string
		status        int
		code, message string
	}{
		{"empty", func(sqlmock.Sqlmock) {}, " \t", 400, "invalid_public_key", "public key is required"},
		{"missing-user", func(m sqlmock.Sqlmock) {
			m.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
		}, "key", 401, "invalid_session", "authenticated user no longer exists"},
		{"connection", func(m sqlmock.Sqlmock) {
			m.ExpectQuery("SELECT EXISTS").WillReturnError(errors.New("dial tcp 127.0.0.1:5998: postgres://secret@host/db connection refused"))
		}, "key", 500, "internal_error", "failed to save public key"},
		{"deadline", func(m sqlmock.Sqlmock) { m.ExpectQuery("SELECT EXISTS").WillReturnError(context.DeadlineExceeded) }, "key", 500, "internal_error", "failed to save public key"},
		{"write-error", func(m sqlmock.Sqlmock) {
			m.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			m.ExpectExec("INSERT INTO auth.public_keys").WillReturnError(&pq.Error{Code: "42501", Message: "permission denied for table auth.public_keys"})
		}, "key", 500, "internal_error", "failed to save public key"},
		{"deleted-during-write", func(m sqlmock.Sqlmock) {
			m.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			m.ExpectExec("INSERT INTO auth.public_keys").WillReturnError(&pq.Error{Code: "23503", Message: "internal foreign key details"})
		}, "key", 401, "invalid_session", "authenticated user no longer exists"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, m := qrHandler(t)
			tc.setup(m)
			body, err := json.Marshal(map[string]string{"publicKey": tc.key})
			require.NoError(t, err)
			response := qrCall(h.PublicKey, http.MethodPost, "/public-key", "", string(body), "owner")
			require.Equal(t, tc.status, response.Code, response.Body.String())
			data := decodeJSON(t, response)
			require.Equal(t, tc.code, data["code"])
			require.Equal(t, tc.message, data["message"])
			require.Empty(t, response.Result().Cookies())
			require.NoError(t, m.ExpectationsWereMet())
		})
	}
}
