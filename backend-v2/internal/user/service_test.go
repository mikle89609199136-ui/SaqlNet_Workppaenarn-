package user_test

import (
	"context"
	"craneapp/backend-v2/internal/user"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// TestIsUsernameAvailable_ReturnsFalseWhenTaken проверяет, что занятый
// username (в любом регистре, проверка через lower() в SQL) недоступен.
func TestIsUsernameAvailable_ReturnsFalseWhenTaken(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	svc := user.NewService(db)

	mock.ExpectQuery("SELECT EXISTS").WithArgs("ivan").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	available, err := svc.IsUsernameAvailable(context.Background(), "ivan")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if available {
		t.Fatal("expected username to be unavailable")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestIsUsernameAvailable_ReturnsTrueWhenFree проверяет, что свободный
// username доступен для регистрации.
func TestIsUsernameAvailable_ReturnsTrueWhenFree(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()
	svc := user.NewService(db)
	mock.ExpectQuery("SELECT EXISTS").WithArgs("ivan").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	available, err := svc.IsUsernameAvailable(context.Background(), "ivan")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !available {
		t.Fatal("expected username to be available")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestIsUsernameAvailable_ReturnsErrInvalidInputOnEmpty проверяет, что пустой
// username отклоняется без обращения к базе.
func TestIsUsernameAvailable_ReturnsErrInvalidInputOnEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()
	svc := user.NewService(db)

	_, err = svc.IsUsernameAvailable(context.Background(), "    ")
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestSearch_ReturnsUsernameAsIs проверяет, что Search возвращает username
// из базы без изменений, не добавляя и не отрезая дискриминатор.
func TestSearch_ReturnsUsernameAsIs(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()
	svc := user.NewService(db)

	mock.ExpectQuery("SELECT au.id::text, au.username").WithArgs("%ivan%", "viewer-id").WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).AddRow("user-id", "ivan.123", "Ivan", "", ""))

	results, err := svc.Search(context.Background(), "viewer-id", "ivan")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Username != "ivan.123" {
		t.Fatalf("expected username ivan.123, got %s", results[0].Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestSearch_DoesNotStripDiscriminatorFromQuery проверяет, что поисковый
// запрос вида ivan.123 передаётся в базу целиком, без отрезания суффикса .N.
func TestSearch_DoesNotStripDiscriminatorFromQuery(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	svc := user.NewService(db)

	mock.ExpectQuery("SELECT au.id::text, au.username").
		WithArgs("%ivan.123%", "viewer-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
			AddRow("user-id", "ivan.123", "Ivan", "", ""))

	_, err = svc.Search(context.Background(), "viewer-id", "ivan.123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestBlocked_ReturnsUsernameAsIs проверяет, что список заблокированных
// возвращает username как есть, без форматирования base.N.
func TestBlocked_ReturnsUsernameAsIs(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	svc := user.NewService(db)

	mock.ExpectQuery("SELECT au.id::text, au.username").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "blocked_at"}).
			AddRow("blocked-id", "ivan.5", "Ivan", "", "", "2024-01-01 00:00:00"))

	blocked, err := svc.Blocked(context.Background(), "user-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(blocked) != 1 {
		t.Fatalf("expected 1 blocked user, got %d", len(blocked))
	}
	if blocked[0].Username != "ivan.5" {
		t.Fatalf("expected username ivan.5, got %s", blocked[0].Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestProfileByID_ReturnsUsernameAsIs проверяет, что профиль возвращает
// username как есть, без добавления дискриминатора.
func TestProfileByID_ReturnsUsernameAsIs(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	svc := user.NewService(db)

	mock.ExpectQuery("SELECT au.id::text, au.username").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "bio", "avatar_url", "badges", "is_premium"}).
			AddRow("user-id", "ivan.7", "Ivan", "", "", "", "{}", false))

	profile, err := svc.ProfileByID(context.Background(), "user-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if profile.Username != "ivan.7" {
		t.Fatalf("expected username ivan.7, got %s", profile.Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
