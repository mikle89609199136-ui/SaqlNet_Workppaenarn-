package auth_test

import (
	"context"
	"craneapp/backend-v2/internal/auth"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

type mockCrypto struct {
	hashFunc       func(ctx context.Context, password string) (string, error)
	verifyFunc     func(ctx context.Context, password, hash string) (bool, error)
	issueTokenFunc func(ctx context.Context, userID, username string) (string, error)
}

func (m *mockCrypto) HashPassword(ctx context.Context, password string) (string, error) {
	return m.hashFunc(ctx, password)
}

func (m *mockCrypto) VerifyPassword(ctx context.Context, password, hash string) (bool, error) {
	return m.verifyFunc(ctx, password, hash)
}

func (m *mockCrypto) IssueToken(ctx context.Context, userID, username string) (string, error) {
	return m.issueTokenFunc(ctx, userID, username)
}

// TestRegister_CreatesUserWithExactUsername проверяет, что при регистрации
// username сохраняется без автодобавления дискриминатора, и возвращается
// ровно тот username, который ввёл пользователь.
func TestRegister_CreatesUserWithExactUsername(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{
		hashFunc: func(ctx context.Context, password string) (string, error) {
			return "hash", nil
		},
		issueTokenFunc: func(ctx context.Context, userID, username string) (string, error) {
			return "token", nil
		},
	}

	svc := auth.NewService(db, crypto)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO auth.users").WithArgs("ivan", "hash", "Ivan", "").WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name"}).AddRow("user_id", "ivan", "Ivan", ""))
	mock.ExpectExec("INSERT INTO users.profiles").WithArgs("user_id", "Ivan", "").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO users.settings").WithArgs("user_id", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	user, token, err := svc.Register(context.Background(), "ivan", "password", "Ivan", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if user.Username != "ivan" {
		t.Fatalf("expected username ivan, got %s", user.Username)
	}
	if token != "token" {
		t.Fatalf("expected token token, got %s", token)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestRegister_ReturnsErrUsernameTakenOnDuplicate проверяет, что попытка
// зарегистрировать уже занятый username завершается ошибкой ErrUsernameTaken,
// а не генерацией нового дискриминатора.
func TestRegister_ReturnsErrUsernameTakenOnDuplicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{
		hashFunc: func(ctx context.Context, password string) (string, error) {
			return "hash", nil
		},
	}

	svc := auth.NewService(db, crypto)

	pgErr := &pq.Error{
		Code:       "23505",
		Constraint: "auth_users_username_lower_key",
	}

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO auth.users").WithArgs("ivan", "hash", "Ivan", "").WillReturnError(pgErr)
	mock.ExpectRollback()

	_, _, err = svc.Register(context.Background(), "ivan", "password", "Ivan", "", "")
	if !errors.Is(err, auth.ErrUsernameTaken) {
		t.Fatalf("expected ErrUsernameTaken, got %v", err)
	}
}

// TestRegister_StoresUsernameLowercase проверяет, что username приводится
// к нижнему регистру перед сохранением, независимо от регистра ввода.
func TestRegister_StoresUsernameLowercase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{
		hashFunc:       func(ctx context.Context, password string) (string, error) { return "hash", nil },
		issueTokenFunc: func(ctx context.Context, userID, username string) (string, error) { return "token", nil },
	}

	svc := auth.NewService(db, crypto)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO auth.users").WithArgs("ivan", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name"}).AddRow("user_id", "ivan", "Ivan", ""))
	mock.ExpectExec("INSERT INTO users.profiles").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO users.settings").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	user, _, err := svc.Register(context.Background(), "Ivan", "password", "Ivan", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.Username != "ivan" {
		t.Fatalf("expected lowercase username ivan, got %s", user.Username)
	}
}

// TestLogin_FindsUserByExactUsername проверяет, что логин выполняется
// по точному совпадению username без парсинга суффикса .N.
func TestLogin_FindsUserByExactUsername(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{
		verifyFunc:     func(ctx context.Context, password, hash string) (bool, error) { return true, nil },
		issueTokenFunc: func(ctx context.Context, userID, username string) (string, error) { return "token", nil },
	}

	svc := auth.NewService(db, crypto)
	mock.ExpectQuery("SELECT u.id::text, u.username, u.first_name, u.last_name, u.password_hash").
		WithArgs("ivan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash FROM auth.users").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash"}).
			AddRow(false, nil))

	user, _, err := svc.Login(context.Background(), "ivan", "password", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.Username != "ivan" {
		t.Fatalf("expected username ivan, got %s", user.Username)
	}
}

// TestLogin_DoesNotParseDiscriminator проверяет, что username вида ivan.123
// воспринимается как одно целое имя, а не разбивается на base + discriminator.
func TestLogin_DoesNotParseDiscriminator(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{
		verifyFunc:     func(ctx context.Context, password, hash string) (bool, error) { return true, nil },
		issueTokenFunc: func(ctx context.Context, userID, username string) (string, error) { return "token", nil },
	}

	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT u.id::text, u.username, u.first_name, u.last_name, u.password_hash").
		WithArgs("ivan.123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan.123", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash FROM auth.users").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash"}).
			AddRow(false, nil))

	user, _, err := svc.Login(context.Background(), "ivan.123", "password", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.Username != "ivan.123" {
		t.Fatalf("expected username ivan.123, got %s", user.Username)
	}
}

// TestLogin_ReturnsInvalidCredentialsWhenUserNotFound проверяет, что логин
// с несуществующим username возвращает ErrInvalidCredentials.
func TestLogin_ReturnsInvalidCredentialsWhenUserNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT u.id::text, u.username, u.first_name, u.last_name, u.password_hash").WithArgs("ivan").WillReturnError(sql.ErrNoRows)

	_, _, err = svc.Login(context.Background(), "ivan", "password", "")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}
