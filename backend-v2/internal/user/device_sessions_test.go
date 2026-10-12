package user_test

import (
	"database/sql"
	"errors"
	"testing"

	"craneapp/backend-v2/internal/user"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestRegisterDeviceLinksCurrentCredentialSession(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const userID = "11111111-1111-4111-8111-111111111111"
	const authSessionID = "22222222-2222-4222-8222-222222222222"
	const deviceSessionID = "33333333-3333-4333-8333-333333333333"
	const tokenHash = "token-hash"

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM public.user_sessions").
		WithArgs(userID, "Browser/1.0").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("INSERT INTO public.user_sessions").
		WithArgs(userID, "Browser on Linux", "desktop", "203.0.113.7", "Unknown", "Browser/1.0").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(deviceSessionID))
	mock.ExpectExec("UPDATE public.user_sessions SET is_current = FALSE").
		WithArgs(userID, deviceSessionID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT id::text.*FROM auth.sessions").
		WithArgs(userID, tokenHash).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(authSessionID))
	mock.ExpectExec("UPDATE auth.sessions.*SET device_session_id = NULL").
		WithArgs(deviceSessionID, authSessionID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE auth.sessions SET device_session_id").
		WithArgs(authSessionID, deviceSessionID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	got, err := user.NewService(db).RegisterDevice(
		t.Context(), userID, tokenHash,
		"Browser on Linux", "desktop", "203.0.113.7", "Unknown", "Browser/1.0",
	)
	if err != nil {
		t.Fatalf("register device: %v", err)
	}
	if got != deviceSessionID {
		t.Fatalf("device session id = %q, want %q", got, deviceSessionID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRegisterDeviceRollsBackWhenKnownCredentialBecameInactive(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM public.user_sessions").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("INSERT INTO public.user_sessions").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("33333333-3333-4333-8333-333333333333"))
	mock.ExpectExec("UPDATE public.user_sessions SET is_current = FALSE").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT id::text.*FROM auth.sessions").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT EXISTS").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectRollback()

	_, err = user.NewService(db).RegisterDevice(
		t.Context(), "user-id", "token-hash",
		"Browser", "desktop", "203.0.113.7", "Unknown", "Browser/1.0",
	)
	if !errors.Is(err, user.ErrAuthSessionInactive) {
		t.Fatalf("expected ErrAuthSessionInactive, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
