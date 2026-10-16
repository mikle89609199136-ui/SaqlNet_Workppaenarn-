package user_test

import (
	"database/sql"
	"errors"
	"testing"

	"craneapp/backend-v2/internal/user"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestRegisterDeviceUpdatesOnlyTokenSession(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	const sessionID = "22222222-2222-4222-8222-222222222222"
	mock.ExpectQuery("UPDATE auth.sessions s").
		WithArgs("user-id", "token-hash", "Browser", "desktop", "203.0.113.7", "Unknown", "Browser/1.0").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(sessionID))
	got, err := user.NewService(db).RegisterDevice(t.Context(), "user-id", "token-hash", "Browser", "desktop", "203.0.113.7", "Unknown", "Browser/1.0")
	if err != nil || got != sessionID {
		t.Fatalf("session=%q err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRegisterDeviceRejectsInactiveOrUnknownCredential(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery("UPDATE auth.sessions s").WillReturnError(sql.ErrNoRows)
	_, err = user.NewService(db).RegisterDevice(t.Context(), "user-id", "token-hash", "Browser", "desktop", "", "", "Browser/1.0")
	if !errors.Is(err, user.ErrAuthSessionInactive) {
		t.Fatalf("expected inactive session, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
