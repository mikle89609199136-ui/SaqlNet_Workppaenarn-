package user_test

import (
	"context"
	"craneapp/backend-v2/internal/user"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
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

// TestCheckUsername_ValidationErrors verifies that the /check-username endpoint
// returns 400 Bad Request with a "validation_failed" error code for all
// malformed or invalid usernames.
//
// It uses a table-driven approach and sqlmock to ensure no database query
// is executed for invalid inputs – the validation should reject them early.
func TestCheckUsername_ValidationErrors(t *testing.T) {
	// Setup mock DB and service.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db) // real service with mocked DB
	h := user.NewHandler(svc, nil)

	tests := []struct {
		name           string
		username       string // raw username (may contain special chars)
		expectedStatus int
		expectedCode   string
		expectedMsg    string
	}{
		{
			name:           "empty username",
			username:       "",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username is required",
		},
		{
			name:           "username with space",
			username:       "bad name",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "username with @",
			username:       "user@name",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "too short (2 chars)",
			username:       "ab",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "too long (63 chars)",
			username:       "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ123", // 63 chars
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
		{
			name:           "wrong name format",
			username:       "bad%20name",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "username - wrong format",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Build request URL with properly URL-encoded username.
			u, _ := url.Parse("/api/v2/users/check-username")
			if tt.username != "" {
				q := u.Query()
				q.Set("username", tt.username)
				u.RawQuery = q.Encode()
			}
			req := httptest.NewRequest(http.MethodGet, u.String(), nil)
			w := httptest.NewRecorder()

			// Execute handler.
			h.CheckUsername(w, req)

			// Verify HTTP status.
			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			// Decode and validate JSON response.
			var resp map[string]interface{}
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if code, ok := resp["code"]; !ok || code != tt.expectedCode {
				t.Errorf("expected code %q, got %v", tt.expectedCode, code)
			}
			if msg, ok := resp["message"]; !ok || msg != tt.expectedMsg {
				t.Errorf("expected message %q, got %v", tt.expectedMsg, msg)
			}

			// Ensure no database query was attempted (since no expectations were set).
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unexpected database call: %v", err)
			}
		})
	}
}
