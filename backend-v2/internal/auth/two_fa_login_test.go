package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/auth"
	cryptoclient "craneapp/backend-v2/internal/platform/crypto"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestLoginRequiresConsistentVerifiedTwoFA(t *testing.T) {
	dbFailure := errors.New("private database error")
	for _, tc := range []struct {
		name                     string
		enabled                  bool
		hash                     any
		second                   string
		readErr, error2, wantErr error
		wantStatus, calls        int
		issued                   bool
	}{
		{name: "disabled", hash: nil, wantStatus: 200, calls: 1, issued: true},
		{name: "correct second password", enabled: true, hash: "second-hash", second: "correct", wantStatus: 200, calls: 2, issued: true},
		{name: "challenge", enabled: true, hash: "second-hash", wantErr: auth.ErrTwoFARequired, wantStatus: 200, calls: 1},
		{name: "wrong second password", enabled: true, hash: "second-hash", second: "wrong", wantErr: auth.ErrInvalidTwoFA, wantStatus: 401, calls: 2},
		{name: "missing hash", enabled: true, hash: nil, second: "anything", wantErr: auth.ErrInvalidTwoFAState, wantStatus: 500, calls: 1},
		{name: "missing hash without second password", enabled: true, hash: nil, wantErr: auth.ErrInvalidTwoFAState, wantStatus: 500, calls: 1},
		{name: "empty hash", enabled: true, hash: "", second: "anything", wantErr: auth.ErrInvalidTwoFAState, wantStatus: 500, calls: 1},
		{name: "whitespace hash", enabled: true, hash: " \t\n", second: "anything", wantErr: auth.ErrInvalidTwoFAState, wantStatus: 500, calls: 1},
		{name: "read failure", readErr: dbFailure, wantErr: dbFailure, wantStatus: 500, calls: 1},
		{name: "crypto failure", enabled: true, hash: "second-hash", second: "correct", error2: cryptoclient.ErrUnavailable, wantErr: cryptoclient.ErrUnavailable, wantStatus: 503, calls: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Check both service-level denial and the HTTP cookie boundary.
			for _, throughHTTP := range []bool{false, true} {
				db, mock, err := sqlmock.New()
				require.NoError(t, err)
				mock.ExpectQuery("SELECT u.id::text, u.username,").WithArgs("ivan").WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).AddRow("user-id", "ivan", "Ivan", "", "primary-hash", "", ""))
				flags := mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").WithArgs("user-id")
				if tc.readErr != nil {
					flags.WillReturnError(tc.readErr)
				} else {
					flags.WillReturnRows(sqlmock.NewRows([]string{"enabled", "hash", "generation"}).AddRow(tc.enabled, tc.hash, 0))
				}
				calls, issues := 0, 0
				crypto := &mockCrypto{
					verifyFunc: func(ctx context.Context, password, hash string) (bool, error) {
						calls++
						if calls == 1 {
							require.Equal(t, "primary-hash", hash)
							return true, nil
						}
						require.Equal(t, "second-hash", hash)
						return password == "correct", tc.error2
					},
					issueTokenFunc: func(context.Context, string, string, int64) (string, error) { issues++; return "issued-token", nil },
				}
				if tc.issued {
					expectTokenGeneration(mock, "user-id", 0)
					expectSessionRecord(mock, "user-id", 0)
				}
				service := auth.NewService(db, crypto)
				if throughHTTP {
					body := `{"username":"ivan","password":"primary","twoFAPassword":"` + tc.second + `"}`
					r := httptest.NewRequest(http.MethodPost, "/api/v2/auth/login", strings.NewReader(body))
					w := httptest.NewRecorder()
					auth.NewHandler(service).Login(w, r)
					require.Equal(t, tc.wantStatus, w.Code, w.Body.String())
					require.Equal(t, tc.issued, w.Header().Get("Set-Cookie") != "")
					require.NotContains(t, w.Body.String(), "private database")
					require.NotContains(t, w.Body.String(), "password hash")
					if tc.wantErr == auth.ErrTwoFARequired {
						require.Contains(t, w.Body.String(), `"twoFARequired":true`)
					}
				} else {
					_, token, err := service.Login(t.Context(), "ivan", "primary", tc.second)
					require.ErrorIs(t, err, tc.wantErr)
					require.Equal(t, tc.issued, token != "")
				}
				require.Equal(t, tc.calls, calls)
				if tc.issued {
					require.Equal(t, 1, issues)
				} else {
					require.Zero(t, issues)
				}
				mock.ExpectClose()
				require.NoError(t, db.Close())
				require.NoError(t, mock.ExpectationsWereMet())
			}
		})
	}
}
