package user_test

import (
	"database/sql"
	"errors"
	"testing"

	"craneapp/backend-v2/internal/user"

	"github.com/DATA-DOG/go-sqlmock"
)

// =============================================================================
// RegisterDevice
// =============================================================================

// TestRegisterDevice_CreatesNewSession verifies that the first registration
// for a (user_id, user_agent) pair inserts a new row into user_sessions:
// INSERT ... RETURNING id, followed by clearing is_current on the user's
// other sessions, and finally a commit.
func TestRegisterDevice_CreatesNewSession(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO public\.user_sessions.*RETURNING id`).
		WithArgs("user-id", "Device One", "desktop", "IP A", "Unknown", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	id, err := user.NewService(db).RegisterDevice(
		t.Context(), "user-id", "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "session-1" {
		t.Fatalf("expected session-1, got %q", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_UpdatesExistingSession_SameUserAgent verifies that a
// repeat registration with the same user_agent does not create a duplicate
// row but instead overwrites the existing session's metadata
// (device_name, device_type, ip_address, location) and returns the same
// sessionID.
func TestRegisterDevice_UpdatesExistingSession_SameUserAgent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions\s+SET device_name = \$2.*WHERE id = \$1`).
		WithArgs("session-1", "Renamed Device", "mobile", "IP B", "Unknown").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	id, err := user.NewService(db).RegisterDevice(
		t.Context(), "user-id", "",
		"Renamed Device", "mobile", "IP B", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "session-1" {
		t.Fatalf("expected same session-1, got %q", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_Idempotent_ReturnsSameID verifies that two consecutive
// registrations with the same user_agent return the same sessionID: the
// first produces an INSERT, the second an UPDATE of the same row.
func TestRegisterDevice_Idempotent_ReturnsSameID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// First call: INSERT.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO public\.user_sessions.*RETURNING id`).
		WithArgs("user-id", "Device One", "desktop", "IP A", "Unknown", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Second call: UPDATE of the same row.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions\s+SET device_name = \$2.*WHERE id = \$1`).
		WithArgs("session-1", "Renamed Device", "mobile", "IP B", "Unknown").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := user.NewService(db)

	id1, err := svc.RegisterDevice(
		t.Context(), "user-id", "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("register #1: %v", err)
	}
	id2, err := svc.RegisterDevice(
		t.Context(), "user-id", "",
		"Renamed Device", "mobile", "IP B", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("idempotency broken: %q vs %q", id1, id2)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_UnknownToken_NoLinkNoError verifies that a completely
// unknown access_token_hash (neither an active nor a historical row) does
// not produce an error: the session is registered, the transaction commits,
// and no auth.sessions link is created.
func TestRegisterDevice_UnknownToken_NoLinkNoError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO public\.user_sessions.*RETURNING id`).
		WithArgs("user-id", "Device One", "desktop", "IP A", "Unknown", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id::text\s+FROM auth\.sessions\s+WHERE user_id = \$1 AND access_token_hash = \$2.*FOR UPDATE`).
		WithArgs("user-id", "hash-unknown").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT EXISTS \(\s+SELECT 1 FROM auth\.sessions\s+WHERE user_id = \$1 AND access_token_hash = \$2\s+\)`).
		WithArgs("user-id", "hash-unknown").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectCommit()

	id, err := user.NewService(db).RegisterDevice(
		t.Context(), "user-id", "hash-unknown",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "session-1" {
		t.Fatalf("expected session-1, got %q", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_BeginTxError verifies that a failure to open a
// transaction is propagated without touching any tables.
func TestRegisterDevice_BeginTxError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin().WillReturnError(errors.New("boom"))

	_, err = user.NewService(db).RegisterDevice(
		t.Context(), "user-id", "",
		"d", "t", "ip", "loc", "ua",
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegisterDevice_InsertError_RollsBack verifies that an INSERT failure
// while creating a new session causes the transaction to roll back.
func TestRegisterDevice_InsertError_RollsBack(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "ua").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO public\.user_sessions.*RETURNING id`).
		WithArgs("user-id", "d", "t", "ip", "loc", "ua").
		WillReturnError(errors.New("insert boom"))
	mock.ExpectRollback()

	_, err = user.NewService(db).RegisterDevice(
		t.Context(), "user-id", "",
		"d", "t", "ip", "loc", "ua",
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// =============================================================================
// Devices
// =============================================================================

// TestDevices_Empty verifies that Devices returns an empty slice and no
// error when the user has no sessions.
func TestDevices_Empty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectQuery(`SELECT id, COALESCE\(device_name.*ORDER BY last_active DESC`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "device_name", "device_type", "ip_address", "location",
			"user_agent", "last_active", "first_login", "is_current",
		}))

	devices, err := user.NewService(db).Devices(t.Context(), "user-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("expected 0 devices, got %d", len(devices))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDevices_ReturnsAllSorted verifies that Devices returns all sessions
// of the user ordered by last_active descending, sets is_current correctly,
// and maps every column into the corresponding Session field.
func TestDevices_ReturnsAllSorted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	rows := sqlmock.NewRows([]string{
		"id", "device_name", "device_type", "ip_address", "location",
		"user_agent", "last_active", "first_login", "is_current",
	}).
		AddRow("session-2", "Renamed Device", "mobile", "IP B", "Unknown",
			"audit-agent-1", "2024-02-01T10:00:00Z", "2024-02-01T09:00:00Z", true).
		AddRow("session-1", "Device One", "desktop", "IP A", "Unknown",
			"audit-agent-1", "2024-01-01T10:00:00Z", "2024-01-01T09:00:00Z", false)

	mock.ExpectQuery(`SELECT id, COALESCE\(device_name.*ORDER BY last_active DESC`).
		WithArgs("user-id").
		WillReturnRows(rows)

	devices, err := user.NewService(db).Devices(t.Context(), "user-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devices))
	}

	first := devices[0]
	if first.ID != "session-2" ||
		first.DeviceName != "Renamed Device" ||
		first.DeviceType != "mobile" ||
		first.IPAddress != "IP B" ||
		first.Location != "Unknown" ||
		first.UserAgent != "audit-agent-1" ||
		first.LastActive != "2024-02-01T10:00:00Z" ||
		first.FirstLogin != "2024-02-01T09:00:00Z" ||
		!first.IsCurrent {
		t.Fatalf("unexpected first device: %+v", first)
	}

	second := devices[1]
	if second.ID != "session-1" ||
		second.DeviceName != "Device One" ||
		second.DeviceType != "desktop" ||
		second.IPAddress != "IP A" ||
		second.IsCurrent {
		t.Fatalf("unexpected second device: %+v", second)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDevices_QueryError verifies that a query error while listing sessions
// is propagated to the caller.
func TestDevices_QueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectQuery(`SELECT id, COALESCE\(device_name.*ORDER BY last_active DESC`).
		WithArgs("user-id").
		WillReturnError(errors.New("boom"))

	_, err = user.NewService(db).Devices(t.Context(), "user-id")
	if err == nil {
		t.Fatal("expected error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestDevices_ScanError verifies that a row scan error (for example, when
// is_current does not come back as a bool) is not swallowed.
func TestDevices_ScanError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	rows := sqlmock.NewRows([]string{
		"id", "device_name", "device_type", "ip_address", "location",
		"user_agent", "last_active", "first_login", "is_current",
	}).AddRow("session-1", "d", "t", "ip", "loc", "ua", "la", "fl", "not-a-bool")

	mock.ExpectQuery(`SELECT id, COALESCE\(device_name.*ORDER BY last_active DESC`).
		WithArgs("user-id").
		WillReturnRows(rows)

	_, err = user.NewService(db).Devices(t.Context(), "user-id")
	if err == nil {
		t.Fatal("expected scan error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// =============================================================================
// End-to-end scenario from the task
// =============================================================================

// TestRegisterDevice_ReregisterSameUserAgent_ReflectsLatestMetadata
// reproduces the sequence:
//
//  1. Register(audit-agent-1, Device One,     desktop, IP A)
//  2. Register(audit-agent-1, Renamed Device, mobile,  IP B)
//
// Expectations:
//   - RegisterDevice returns the same sessionID;
//   - Devices reports the latest metadata (Renamed Device / mobile / IP B)
//     with is_current = true.
func TestRegisterDevice_ReregisterSameUserAgent_ReflectsLatestMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// First registration: INSERT.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO public\.user_sessions.*RETURNING id`).
		WithArgs("user-id", "Device One", "desktop", "IP A", "Unknown", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Second registration: UPDATE of the same row.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM public\.user_sessions\s+WHERE user_id = \$1 AND user_agent = \$2 LIMIT 1`).
		WithArgs("user-id", "audit-agent-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("session-1"))
	mock.ExpectExec(`UPDATE public\.user_sessions\s+SET device_name = \$2.*WHERE id = \$1`).
		WithArgs("session-1", "Renamed Device", "mobile", "IP B", "Unknown").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE public\.user_sessions SET is_current = FALSE WHERE user_id = \$1 AND id != \$2`).
		WithArgs("user-id", "session-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Devices: one up-to-date row.
	rows := sqlmock.NewRows([]string{
		"id", "device_name", "device_type", "ip_address", "location",
		"user_agent", "last_active", "first_login", "is_current",
	}).AddRow("session-1", "Renamed Device", "mobile", "IP B", "Unknown",
		"audit-agent-1", "2024-02-01T10:00:00Z", "2024-02-01T09:00:00Z", true)

	mock.ExpectQuery(`SELECT id, COALESCE\(device_name.*ORDER BY last_active DESC`).
		WithArgs("user-id").
		WillReturnRows(rows)

	svc := user.NewService(db)

	id1, err := svc.RegisterDevice(
		t.Context(), "user-id", "",
		"Device One", "desktop", "IP A", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("register #1: %v", err)
	}
	id2, err := svc.RegisterDevice(
		t.Context(), "user-id", "",
		"Renamed Device", "mobile", "IP B", "Unknown", "audit-agent-1",
	)
	if err != nil {
		t.Fatalf("register #2: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("expected same sessionID across reregistration, got %q vs %q", id1, id2)
	}

	devices, err := svc.Devices(t.Context(), "user-id")
	if err != nil {
		t.Fatalf("devices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	d := devices[0]
	if d.ID != "session-1" ||
		d.DeviceName != "Renamed Device" ||
		d.DeviceType != "mobile" ||
		d.IPAddress != "IP B" ||
		!d.IsCurrent {
		t.Fatalf("Devices does not reflect latest metadata: %+v", d)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
