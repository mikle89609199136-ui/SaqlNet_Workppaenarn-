package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestLoginDistinguishesPasswordRejectionAndCryptoFailure(t *testing.T) {
	for _, tc := range []struct {
		name, body       string
		upstream, status int
	}{
		{"outage", `private infrastructure detail`, 503, 503},
		{"incomplete verify response", `{}`, 200, 503},
		{"wrong password", `{"valid":false}`, 200, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			mock.ExpectQuery("SELECT u.id::text, u.username,").WithArgs("ivan").WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).AddRow("user-id", "ivan", "Ivan", "", "hash", "", ""))
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.upstream)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			h := NewHandler(NewService(db, cryptoclient.NewClient(upstream.URL)))
			r := httptest.NewRequest(http.MethodPost, "/api/v2/auth/login", strings.NewReader(`{"username":"ivan","password":"Password1"}`))
			w := httptest.NewRecorder()
			h.Login(w, r)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.Empty(t, w.Header().Get("Set-Cookie"))
			require.NotContains(t, w.Body.String(), "private infrastructure")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestPasswordAndTwoFAHandlersReportCryptoFailure(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "private infrastructure", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	for _, tc := range []struct {
		path, body, query string
		rows              *sqlmock.Rows
		handler           func(*Handler) http.HandlerFunc
	}{
		{"change-password", `{"currentPassword":"old","newPassword":"Password123!"}`, "SELECT password_hash", sqlmock.NewRows([]string{"hash"}).AddRow("hash"), func(h *Handler) http.HandlerFunc { return h.ChangePassword }},
		{"2fa/enable", `{"password":"Password123!"}`, "", nil, func(h *Handler) http.HandlerFunc { return h.TwoFAEnable }},
		{"2fa/disable", `{"password":"Password123!"}`, "SELECT two_fa_hash", sqlmock.NewRows([]string{"hash"}).AddRow("hash"), func(h *Handler) http.HandlerFunc { return h.TwoFADisable }},
		{"2fa/verify", `{"password":"Password123!"}`, "SELECT two_fa_enabled, two_fa_hash", sqlmock.NewRows([]string{"enabled", "hash"}).AddRow(true, "hash"), func(h *Handler) http.HandlerFunc { return h.TwoFAVerify }},
	} {
		t.Run(tc.path, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			if tc.query != "" {
				mock.ExpectQuery(tc.query).WithArgs("user-id").WillReturnRows(tc.rows)
			}
			h := NewHandler(NewService(db, cryptoclient.NewClient(upstream.URL)))
			r := httptest.NewRequest(http.MethodPost, "/api/v2/auth/"+tc.path, strings.NewReader(tc.body))
			r = r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: "user-id"}))
			w := httptest.NewRecorder()
			tc.handler(h).ServeHTTP(w, r)
			require.Equal(t, 503, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), "crypto_unavailable")
			require.NotContains(t, w.Body.String(), "private infrastructure")
			require.Empty(t, w.Header().Get("Set-Cookie"))
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
