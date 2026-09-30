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
	issueTokenFunc func(ctx context.Context, userID, username string, tokenGeneration int64) (string, error)
}

func (m *mockCrypto) HashPassword(ctx context.Context, password string) (string, error) {
	return m.hashFunc(ctx, password)
}

func (m *mockCrypto) VerifyPassword(ctx context.Context, password, hash string) (bool, error) {
	return m.verifyFunc(ctx, password, hash)
}

func (m *mockCrypto) IssueToken(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
	return m.issueTokenFunc(ctx, userID, username, tokenGeneration)
}

func expectTokenGeneration(mock sqlmock.Sqlmock, userID string, generation int64) {
	mock.ExpectQuery("SELECT token_generation").
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(generation))
}

func TestLogoutAllIncrementsGenerationAndRevokesSessionsAtomically(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := auth.NewService(db, &mockCrypto{})
	userID := "11111111-1111-4111-8111-111111111111"
	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE auth.users").
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(1))
	mock.ExpectExec("UPDATE auth.sessions").
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("UPDATE public.user_sessions").
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 2))
	// Отозванные устройства больше не получают push (#717).
	mock.ExpectExec("DELETE FROM users.push_subscriptions").
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectCommit()

	if err := svc.LogoutAll(t.Context(), userID); err != nil {
		t.Fatalf("logout all: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLogoutAllRollsBackWhenSessionUpdateFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := auth.NewService(db, &mockCrypto{})
	userID := "11111111-1111-4111-8111-111111111111"
	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE auth.users").WillReturnRows(sqlmock.NewRows([]string{"token_generation"}).AddRow(1))
	mock.ExpectExec("UPDATE auth.sessions").WillReturnError(errors.New("update failed"))
	mock.ExpectRollback()

	if err := svc.LogoutAll(t.Context(), userID); err == nil {
		t.Fatal("expected logout all to fail")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
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
		issueTokenFunc: func(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
			if tokenGeneration != 0 {
				t.Fatalf("expected initial token generation 0, got %d", tokenGeneration)
			}
			return "token", nil
		},
	}

	svc := auth.NewService(db, crypto)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO auth.users").WithArgs("ivan", "hash", "Ivan", "").WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "token_generation"}).AddRow("user_id", "ivan", "Ivan", "", 0))
	mock.ExpectExec("INSERT INTO users.settings").WithArgs("user_id", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	user, token, err := svc.Register(context.Background(), "ivan", "Password1!", "Ivan", "", "")
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

func TestRegister_RollsBackWhenFirstTokenCannotBeIssued(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	issueErr := errors.New("crypto protocol unavailable")
	crypto := &mockCrypto{
		hashFunc: func(context.Context, string) (string, error) { return "hash", nil },
		issueTokenFunc: func(context.Context, string, string, int64) (string, error) {
			return "", issueErr
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO auth.users").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "token_generation"}).
			AddRow("user_id", "ivan", "Ivan", "", 0))
	mock.ExpectExec("INSERT INTO users.settings").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectRollback()

	_, token, err := svc.Register(t.Context(), "ivan", "Password1!", "Ivan", "", "")
	if !errors.Is(err, issueErr) {
		t.Fatalf("expected token issue error, got token=%q err=%v", token, err)
	}
	if token != "" {
		t.Fatalf("expected no token, got %q", token)
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

	_, _, err = svc.Register(context.Background(), "ivan", "Password1!", "Ivan", "", "")
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
		hashFunc: func(ctx context.Context, password string) (string, error) { return "hash", nil },
		issueTokenFunc: func(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
			return "token", nil
		},
	}

	svc := auth.NewService(db, crypto)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO auth.users").WithArgs("ivan", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "token_generation"}).AddRow("user_id", "ivan", "Ivan", "", 0))
	mock.ExpectExec("INSERT INTO users.settings").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	user, _, err := svc.Register(context.Background(), "Ivan", "Password1!", "Ivan", "", "")
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
		verifyFunc: func(ctx context.Context, password, hash string) (bool, error) { return true, nil },
		issueTokenFunc: func(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
			if tokenGeneration != 4 {
				t.Fatalf("expected token generation 4, got %d", tokenGeneration)
			}
			return "token", nil
		},
	}

	svc := auth.NewService(db, crypto)
	mock.ExpectQuery("SELECT u.id::text, u.username,.*COALESCE\\(p.first_name, u.first_name\\), COALESCE\\(p.last_name, u.last_name\\),.*u.password_hash").
		WithArgs("ivan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash", "token_generation"}).
			AddRow(false, nil, 4))
	expectTokenGeneration(mock, "user-id", 4)

	user, _, err := svc.Login(context.Background(), "ivan", "password", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.Username != "ivan" {
		t.Fatalf("expected username ivan, got %s", user.Username)
	}
}

// TestLogin_ReturnsCurrentProfileNames проверяет, что AuthResponse использует
// актуальные имена из users.profiles, а не устаревшие значения auth.users.
func TestLogin_ReturnsCurrentProfileNames(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	crypto := &mockCrypto{
		verifyFunc: func(ctx context.Context, password, hash string) (bool, error) { return true, nil },
		issueTokenFunc: func(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
			return "token", nil
		},
	}

	svc := auth.NewService(db, crypto)
	mock.ExpectQuery("SELECT u.id::text, u.username,.*COALESCE\\(p.first_name, u.first_name\\), COALESCE\\(p.last_name, u.last_name\\),.*u.password_hash").
		WithArgs("ivan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan", "Updated", "Profile", "hash", "bio", "avatar"))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash", "token_generation"}).
			AddRow(false, nil, 0))
	expectTokenGeneration(mock, "user-id", 0)

	user, _, err := svc.Login(context.Background(), "ivan", "password", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.FirstName != "Updated" || user.LastName != "Profile" {
		t.Fatalf("expected current profile name Updated Profile, got %q %q", user.FirstName, user.LastName)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
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
		verifyFunc: func(ctx context.Context, password, hash string) (bool, error) { return true, nil },
		issueTokenFunc: func(ctx context.Context, userID, username string, tokenGeneration int64) (string, error) {
			return "token", nil
		},
	}

	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT u.id::text, u.username,.*COALESCE\\(p.first_name, u.first_name\\), COALESCE\\(p.last_name, u.last_name\\),.*u.password_hash").
		WithArgs("ivan.123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan.123", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash", "token_generation"}).
			AddRow(false, nil, 0))
	expectTokenGeneration(mock, "user-id", 0)

	user, _, err := svc.Login(context.Background(), "ivan.123", "password", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.Username != "ivan.123" {
		t.Fatalf("expected username ivan.123, got %s", user.Username)
	}
}

func TestLogin_ReissuesTokenWhenGenerationChangesDuringIssuance(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	issuedGenerations := make([]int64, 0, 2)
	crypto := &mockCrypto{
		verifyFunc: func(context.Context, string, string) (bool, error) { return true, nil },
		issueTokenFunc: func(_ context.Context, _, _ string, generation int64) (string, error) {
			issuedGenerations = append(issuedGenerations, generation)
			if generation == 4 {
				return "stale-token", nil
			}
			return "current-token", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT u.id::text, u.username").
		WithArgs("ivan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash", "token_generation"}).
			AddRow(false, nil, 4))
	expectTokenGeneration(mock, "user-id", 5)
	expectTokenGeneration(mock, "user-id", 5)

	_, token, err := svc.Login(t.Context(), "ivan", "password", "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if token != "current-token" {
		t.Fatalf("expected current-generation token, got %q", token)
	}
	if len(issuedGenerations) != 2 || issuedGenerations[0] != 4 || issuedGenerations[1] != 5 {
		t.Fatalf("expected generations [4 5], got %v", issuedGenerations)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLogin_StopsAfterGenerationRetryLimit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	issueCalls := 0
	crypto := &mockCrypto{
		verifyFunc: func(context.Context, string, string) (bool, error) { return true, nil },
		issueTokenFunc: func(_ context.Context, _, _ string, generation int64) (string, error) {
			if generation != int64(issueCalls) {
				t.Fatalf("issue call %d: expected generation %d, got %d", issueCalls+1, issueCalls, generation)
			}
			issueCalls++
			return "stale-token", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT u.id::text, u.username").
		WithArgs("ivan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "password_hash", "bio", "avatar_url"}).
			AddRow("user-id", "ivan", "Ivan", "", "hash", "", ""))
	mock.ExpectQuery("SELECT two_fa_enabled, two_fa_hash, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"two_fa_enabled", "two_fa_hash", "token_generation"}).
			AddRow(false, nil, 0))
	expectTokenGeneration(mock, "user-id", 1)
	expectTokenGeneration(mock, "user-id", 2)
	expectTokenGeneration(mock, "user-id", 3)

	_, token, err := svc.Login(t.Context(), "ivan", "password", "")
	if !errors.Is(err, auth.ErrTokenGenerationChanged) {
		t.Fatalf("expected ErrTokenGenerationChanged, got token=%q err=%v", token, err)
	}
	if token != "" {
		t.Fatalf("expected no token after retry exhaustion, got %q", token)
	}
	if issueCalls != 3 {
		t.Fatalf("expected 3 issue attempts, got %d", issueCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueQRToken_RejectsWhenLogoutAllCommitsDuringIssuance(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	issuedGenerations := make([]int64, 0, 1)
	crypto := &mockCrypto{
		issueTokenFunc: func(_ context.Context, _, _ string, generation int64) (string, error) {
			issuedGenerations = append(issuedGenerations, generation)
			return "stale-token", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT username, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("ivan", 7))
	expectTokenGeneration(mock, "user-id", 8)

	token, err := svc.IssueQRToken(t.Context(), "user-id", 7)
	if !errors.Is(err, auth.ErrAuthorizationRevoked) {
		t.Fatalf("expected ErrAuthorizationRevoked, got token=%q err=%v", token, err)
	}
	if token != "" {
		t.Fatalf("expected no token after concurrent logout-all, got %q", token)
	}
	if len(issuedGenerations) != 1 || issuedGenerations[0] != 7 {
		t.Fatalf("expected only generation 7 to be issued, got %v", issuedGenerations)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueQRToken_RejectsAlreadyRevokedAuthorizer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	issueCalls := 0
	crypto := &mockCrypto{
		issueTokenFunc: func(_ context.Context, _, _ string, generation int64) (string, error) {
			issueCalls++
			return "must-not-be-issued", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT username, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("ivan", 8))

	token, err := svc.IssueQRToken(t.Context(), "user-id", 7)
	if !errors.Is(err, auth.ErrAuthorizationRevoked) {
		t.Fatalf("expected ErrAuthorizationRevoked, got token=%q err=%v", token, err)
	}
	if token != "" {
		t.Fatalf("expected no token for revoked authorizer, got %q", token)
	}
	if issueCalls != 0 {
		t.Fatalf("expected no issue attempt, got %d", issueCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueQRToken_ReturnsGenerationRecheckError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	recheckErr := errors.New("generation read failed")
	crypto := &mockCrypto{
		issueTokenFunc: func(context.Context, string, string, int64) (string, error) {
			return "unverified-token", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT username, token_generation").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "token_generation"}).AddRow("ivan", 0))
	mock.ExpectQuery("SELECT token_generation").
		WithArgs("user-id").
		WillReturnError(recheckErr)

	token, err := svc.IssueQRToken(t.Context(), "user-id", 0)
	if !errors.Is(err, recheckErr) {
		t.Fatalf("expected generation recheck error, got token=%q err=%v", token, err)
	}
	if token != "" {
		t.Fatalf("expected no token after generation recheck failure, got %q", token)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
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

	mock.ExpectQuery("SELECT u.id::text, u.username,.*COALESCE\\(p.first_name, u.first_name\\), COALESCE\\(p.last_name, u.last_name\\),.*u.password_hash").WithArgs("ivan").WillReturnError(sql.ErrNoRows)

	_, _, err = svc.Login(context.Background(), "ivan", "password", "")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestRegister_RejectsInvalidPasswordBeforeHashingOrDatabase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	hashCalled := false
	crypto := &mockCrypto{
		hashFunc: func(ctx context.Context, password string) (string, error) {
			hashCalled = true
			return "hash", nil
		},
	}
	svc := auth.NewService(db, crypto)

	_, _, err = svc.Register(context.Background(), "ivan", "password", "Ivan", "", "")
	assertPasswordValidationError(t, err)
	if hashCalled {
		t.Fatal("HashPassword was called for an invalid password")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestChangePassword_RejectsInvalidNewPasswordAfterCurrentPasswordVerification(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	verifyCalled := false
	hashCalled := false
	crypto := &mockCrypto{
		verifyFunc: func(ctx context.Context, password, hash string) (bool, error) {
			verifyCalled = true
			return true, nil
		},
		hashFunc: func(ctx context.Context, password string) (string, error) {
			hashCalled = true
			return "new-hash", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT password_hash FROM auth.users").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"password_hash"}).AddRow("current-hash"))

	err = svc.ChangePassword(context.Background(), "user-id", "current-password", "password123")
	if !errors.Is(err, auth.ErrInvalidPassword) {
		t.Fatalf("expected ErrInvalidPassword, got %v", err)
	}
	var validationErr *auth.PasswordValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected PasswordValidationError, got %T", err)
	}
	if validationErr.Reason != auth.PasswordSpecialRequired {
		t.Fatalf("expected reason %q, got %q", auth.PasswordSpecialRequired, validationErr.Reason)
	}
	if !verifyCalled {
		t.Fatal("VerifyPassword was not called before new password validation")
	}
	if hashCalled {
		t.Fatal("HashPassword was called for an invalid new password")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestChangePassword_WrongCurrentPasswordTakesPriority(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	hashCalled := false
	crypto := &mockCrypto{
		verifyFunc: func(ctx context.Context, password, hash string) (bool, error) {
			return false, nil
		},
		hashFunc: func(ctx context.Context, password string) (string, error) {
			hashCalled = true
			return "new-hash", nil
		},
	}
	svc := auth.NewService(db, crypto)

	mock.ExpectQuery("SELECT password_hash FROM auth.users").
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"password_hash"}).AddRow("current-hash"))

	err = svc.ChangePassword(context.Background(), "user-id", "wrong-password", "password")
	if !errors.Is(err, auth.ErrWrongPassword) {
		t.Fatalf("expected ErrWrongPassword, got %v", err)
	}
	if errors.Is(err, auth.ErrInvalidPassword) {
		t.Fatalf("expected wrong current password to take priority, got %v", err)
	}
	if hashCalled {
		t.Fatal("HashPassword was called after current password verification failed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTwoFAEnable_RejectsInvalidPasswordBeforeHashingOrDatabase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = db.Close()
	}()

	hashCalled := false
	crypto := &mockCrypto{
		hashFunc: func(ctx context.Context, password string) (string, error) {
			hashCalled = true
			return "hash", nil
		},
	}
	svc := auth.NewService(db, crypto)

	err = svc.TwoFAEnable(context.Background(), "user-id", "password")
	assertPasswordValidationError(t, err)
	if hashCalled {
		t.Fatal("HashPassword was called for an invalid 2FA password")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func assertPasswordValidationError(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, auth.ErrInvalidPassword) {
		t.Fatalf("expected ErrInvalidPassword, got %v", err)
	}
	var validationErr *auth.PasswordValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected *PasswordValidationError, got %T", err)
	}
}
