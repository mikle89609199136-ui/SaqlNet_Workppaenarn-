package user_test

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/user"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// Metadata enrichment operates on an existing credential, never a User-Agent identity.
func TestRegisterDevice_ReregistrationPreservesSessionID(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	for _, name := range []string{"Device One", "Renamed Device"} {
		mock.ExpectQuery(`UPDATE auth\.sessions s`).
			WithArgs("user-id", "token-hash", name, "mobile", "IP B", "Unknown", "audit-agent-1").
			WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
		id, err := user.NewService(db).RegisterDevice(t.Context(), "user-id", "token-hash",
			name, "mobile", "IP B", "Unknown", "audit-agent-1")
		require.NoError(t, err)
		require.Equal(t, "session-1", id)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRegisterDevice_DatabaseError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	failure := errors.New("metadata update failed")
	mock.ExpectQuery(`UPDATE auth\.sessions s`).WillReturnError(failure)
	_, err = user.NewService(db).RegisterDevice(t.Context(), "user-id", "token-hash", "d", "t", "ip", "loc", "ua")
	require.ErrorIs(t, err, failure)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDevices_Empty(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).WillReturnRows(deviceRows())
	devices, err := user.NewService(db).Devices(t.Context(), "user-id", "caller-token")
	require.NoError(t, err)
	require.Empty(t, devices)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDevices_ReturnsCanonicalMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	active := time.Date(2026, 10, 16, 10, 0, 0, 123000000, time.UTC)
	created := active.Add(-time.Hour)
	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).
		WillReturnRows(deviceRows().
			AddRow("session-2", "Renamed Device", "mobile", "IP B", active, created, "Unknown", "audit-agent-1", true).
			AddRow("session-1", "Device One", "desktop", "IP A", created, created, "Elsewhere", "other-agent", false))
	devices, err := user.NewService(db).Devices(t.Context(), "user-id", "caller-token")
	require.NoError(t, err)
	require.Equal(t, []user.Session{
		{ID: "session-2", DeviceName: "Renamed Device", DeviceType: "mobile", IPAddress: "IP B",
			Location: "Unknown", UserAgent: "audit-agent-1", LastActive: active.Format(time.RFC3339Nano),
			FirstLogin: created.Format(time.RFC3339Nano), IsCurrent: true},
		{ID: "session-1", DeviceName: "Device One", DeviceType: "desktop", IPAddress: "IP A",
			Location: "Elsewhere", UserAgent: "other-agent", LastActive: created.Format(time.RFC3339Nano),
			FirstLogin: created.Format(time.RFC3339Nano)},
	}, devices)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDevices_QueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	failure := errors.New("sessions unavailable")
	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).WillReturnError(failure)
	_, err = user.NewService(db).Devices(t.Context(), "user-id", "caller-token")
	require.ErrorIs(t, err, failure)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDevices_ScanError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(`SELECT s.id::text.*FROM auth.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).
		WillReturnRows(deviceRows().AddRow("session-1", "d", "t", "ip", time.Now(), time.Now(), "loc", "ua", "not-a-bool"))
	_, err = user.NewService(db).Devices(t.Context(), "user-id", "caller-token")
	require.ErrorContains(t, err, "not-a-bool")
	require.NoError(t, mock.ExpectationsWereMet())
}

func deviceRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "device_name", "device_type", "ip_address", "last_active", "created_at", "location", "user_agent", "is_current",
	})
}

// Keep sql.ErrNoRows semantics covered alongside generic database failures.
func TestRegisterDevice_UnknownCredentialCannotCreateDevice(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(`UPDATE auth\.sessions s`).WillReturnError(sql.ErrNoRows)
	id, err := user.NewService(db).RegisterDevice(t.Context(), "user-id", "unknown-hash", "d", "t", "ip", "loc", "ua")
	require.ErrorIs(t, err, user.ErrAuthSessionInactive)
	require.Empty(t, id)
	require.NoError(t, mock.ExpectationsWereMet())
}
