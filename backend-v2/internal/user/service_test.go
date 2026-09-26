package user_test

import (
	"context"
	"craneapp/backend-v2/internal/user"
	"database/sql"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

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

func TestRenameUsername_NormalizesAndAuditsAtomically(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT username\s+FROM auth\.users.*FOR UPDATE`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("old_name"))
	mock.ExpectQuery(`SELECT changed_at\s+FROM users\.username_changes`).
		WithArgs("user-id").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO auth\.username_registry`).
		WithArgs("alice_1", "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("alice_1"))
	mock.ExpectExec(`UPDATE auth\.users`).
		WithArgs("user-id", "alice_1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO users\.username_changes`).
		WithArgs("user-id", "old_name", "alice_1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`SELECT pg_notify`).
		WithArgs("crane_user_profile_changed", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT au\.id::text, au\.username`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "bio", "avatar_url", "badges", "is_premium"}).
			AddRow("user-id", "alice_1", "Alice", "", "", "", "{}", false))

	profile, err := user.NewService(db).RenameUsername(context.Background(), "user-id", " Alice_1 ")
	if err != nil {
		t.Fatalf("rename username: %v", err)
	}
	if profile.Username != "alice_1" {
		t.Fatalf("expected canonical username alice_1, got %q", profile.Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRenameUsername_MapsAtomicUniqueConflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT username\s+FROM auth\.users.*FOR UPDATE`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("old_name"))
	mock.ExpectQuery(`SELECT changed_at\s+FROM users\.username_changes`).
		WithArgs("user-id").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO auth\.username_registry`).
		WithArgs("taken_name", "user-id").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err = user.NewService(db).RenameUsername(context.Background(), "user-id", "TAKEN_NAME")
	if !errors.Is(err, user.ErrUsernameTaken) {
		t.Fatalf("expected ErrUsernameTaken, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRenameUsername_ConcurrentAttemptsAreSerializedBeforeCooldownCheck(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	changedAt := time.Now().Add(-time.Hour)
	mock.ExpectBegin()
	// FOR UPDATE is the concurrency guarantee: a second rename for this user
	// cannot evaluate its cooldown until the first transaction has committed.
	mock.ExpectQuery(`SELECT username\s+FROM auth\.users.*FOR UPDATE`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("old_name"))
	mock.ExpectQuery(`SELECT changed_at\s+FROM users\.username_changes`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"changed_at"}).AddRow(changedAt))
	mock.ExpectRollback()

	_, err = user.NewService(db).RenameUsername(context.Background(), "user-id", "new_name")
	if !errors.Is(err, user.ErrUsernameCooldown) {
		t.Fatalf("expected ErrUsernameCooldown, got %v", err)
	}
	var cooldown *user.UsernameCooldownError
	if !errors.As(err, &cooldown) || !cooldown.AvailableAt.Equal(changedAt.Add(user.UsernameChangeCooldown)) {
		t.Fatalf("unexpected cooldown details: %#v", cooldown)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRenameUsername_ConcurrentAccountsCannotClaimSameName(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(false)

	for _, account := range []struct {
		id, old string
	}{
		{id: "user-1", old: "old_one"},
		{id: "user-2", old: "old_two"},
	} {
		mock.ExpectBegin()
		mock.ExpectQuery(`SELECT username\s+FROM auth\.users.*FOR UPDATE`).
			WithArgs(account.id).
			WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow(account.old))
		mock.ExpectQuery(`SELECT changed_at\s+FROM users\.username_changes`).
			WithArgs(account.id).
			WillReturnError(sql.ErrNoRows)
	}
	mock.ExpectQuery(`INSERT INTO auth\.username_registry`).
		WithArgs("shared_name", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("shared_name"))
	mock.ExpectQuery(`INSERT INTO auth\.username_registry`).
		WithArgs("shared_name", "user-2").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`UPDATE auth\.users`).
		WithArgs("user-1", "shared_name").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO users\.username_changes`).
		WithArgs("user-1", "old_one", "shared_name").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`SELECT pg_notify`).
		WithArgs("crane_user_profile_changed", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT au\.id::text, au\.username`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "bio", "avatar_url", "badges", "is_premium"}).
			AddRow("user-1", "shared_name", "One", "", "", "", "{}", false))
	mock.ExpectRollback()

	svc := user.NewService(db)
	results := make(chan error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, id := range []string{"user-1", "user-2"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, renameErr := svc.RenameUsername(context.Background(), id, "SHARED_NAME")
			results <- renameErr
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	var successes, conflicts int
	for result := range results {
		switch {
		case result == nil:
			successes++
		case errors.Is(result, user.ErrUsernameTaken):
			conflicts++
		default:
			t.Fatalf("unexpected rename result: %v", result)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("expected one winner and one conflict, got successes=%d conflicts=%d", successes, conflicts)
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

func TestProfileByUsername_AllowsLegacyDiscriminator(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT id::text\s+FROM auth\.users\s+WHERE lower\(username\) = \$1`).
		WithArgs("ivan.123").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("user-id"))
	mock.ExpectQuery(`SELECT au\.id::text, au\.username`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "bio", "avatar_url", "badges", "is_premium"}).
			AddRow("user-id", "ivan.123", "Ivan", "", "", "", "{}", false))

	profile, err := user.NewService(db).ProfileByUsername(context.Background(), " IVAN.123 ")
	if err != nil {
		t.Fatalf("lookup legacy username: %v", err)
	}
	if profile.Username != "ivan.123" {
		t.Fatalf("expected legacy username ivan.123, got %q", profile.Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// searchSQL is the exact SQL string used by Service.Search.
// Duplicated here to keep the mock expectations independent from
// the production code; consider exporting it as a const in the
// service package if the query is extracted to a package-level var.
const searchSQL = `
		SELECT au.id::text, au.username,
		       COALESCE(up.first_name, au.first_name),
		       COALESCE(up.last_name, au.last_name),
		       COALESCE(up.avatar_url, '')
		FROM auth.users au
		LEFT JOIN users.profiles up ON up.user_id = au.id
		WHERE au.disabled_at IS NULL
		  AND au.id::text != $2
		  AND (au.username ILIKE $1 OR
		       COALESCE(up.first_name, au.first_name) ILIKE $1 OR
		       COALESCE(up.last_name, au.last_name) ILIKE $1 OR
		       up.bio ILIKE $1)
		ORDER BY au.username
		LIMIT 50
	`

// TestSearch covers all branches of Service.Search:
//   - early returns without a DB call (empty query, whitespace-only query,
//     bare '@' after stripping, queries that become empty after TrimPrefix);
//   - successful searches with and without a leading '@';
//   - SQL LIKE wildcard escaping (%, _, \);
//   - DB and row-scan errors.
func TestSearch(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		viewerID   string
		mockExpect func(mock sqlmock.Sqlmock)
		want       []user.SearchResult
		wantErr    bool
	}{
		// --- Early returns: no DB call must be made ---

		{
			name:     "empty query",
			query:    "",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// No DB call expected.
			},
			want:    []user.SearchResult{},
			wantErr: false,
		},
		{
			name:     "whitespace only query",
			query:    "   ",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// No DB call expected.
			},
			want:    []user.SearchResult{},
			wantErr: false,
		},
		{
			name:     "query '@' returns empty without DB call",
			query:    "@",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// Critical: bare '@' must not list all users via '%%'.
			},
			want:    []user.SearchResult{},
			wantErr: false,
		},
		{
			name:     "query ' @ ' with spaces returns empty without DB call",
			query:    "  @  ",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// TrimSpace + TrimPrefix leave an empty string.
			},
			want:    []user.SearchResult{},
			wantErr: false,
		},

		// --- Successful searches ---

		{
			name:     "query with username after @",
			query:    "@john",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// cleanQuery = "john"; final pattern is "%john%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-2", "john", "John", "Doe", "http://avatar.com/john")
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%john%", "viewer-1").
					WillReturnRows(rows)
			},
			want: []user.SearchResult{
				{ID: "user-2", Username: "john", FirstName: "John", LastName: "Doe", AvatarURL: "http://avatar.com/john"},
			},
			wantErr: false,
		},
		{
			name:     "query without @",
			query:    "john",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// final pattern is "%john%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-2", "john", "John", "Doe", "http://avatar.com/john")
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%john%", "viewer-1").
					WillReturnRows(rows)
			},
			want: []user.SearchResult{
				{ID: "user-2", Username: "john", FirstName: "John", LastName: "Doe", AvatarURL: "http://avatar.com/john"},
			},
			wantErr: false,
		},
		{
			name:     "query '@@' searches for literal '@'",
			query:    "@@",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// Only the first '@' is stripped: cleanQuery = "@";
				// final pattern is "%@%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%@%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query '@@@' searches for literal '@@'",
			query:    "@@@",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// cleanQuery = "@@"; final pattern is "%@@%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%@@%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query '@ @' (space between) searches for ' @'",
			query:    "@ @",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// cleanQuery = " @"; final pattern is "% @%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("% @%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "unicode query",
			query:    "Иван",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-2", "ivan", "Иван", "Иванов", "")
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%Иван%", "viewer-1").
					WillReturnRows(rows)
			},
			want: []user.SearchResult{
				{ID: "user-2", Username: "ivan", FirstName: "Иван", LastName: "Иванов", AvatarURL: ""},
			},
			wantErr: false,
		},

		// --- Special characters: %, _, \ ---

		{
			name:     "query with single percent",
			query:    "%",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// escapeLike("%") -> "\%"; final pattern is "%\%%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-3", "100%pure", "Pure", "Guy", "")
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\%%", "viewer-1").
					WillReturnRows(rows)
			},
			want: []user.SearchResult{
				{ID: "user-3", Username: "100%pure", FirstName: "Pure", LastName: "Guy", AvatarURL: ""},
			},
			wantErr: false,
		},
		{
			name:     "query with single underscore",
			query:    "_",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// escapeLike("_") -> "\_"; final pattern is "%\_%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\_%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query with single backslash",
			query:    "\\",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// escapeLike("\\") -> "\\\\"; final pattern is "%\\\\%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\\\%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query with mixed special chars '%_\\'",
			query:    "%_\\",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// escapeLike("%_\\") -> "\\%\\_\\\\";
				// final pattern is "%\\%\\_\\\\%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\%\\_\\\\%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query with backslash before percent",
			query:    "\\%",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// escapeLike("\\%") -> "\\\\\\%";
				// final pattern is "%\\\\\\%%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\\\\\%%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query '@%' searches for literal '%'",
			query:    "@%",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// cleanQuery = "%"; escapeLike -> "\%";
				// final pattern is "%\%%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\%%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query '@_' searches for literal '_'",
			query:    "@_",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// cleanQuery = "_"; escapeLike -> "\_";
				// final pattern is "%\_%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\_%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "query '@\\' searches for literal backslash",
			query:    "@\\",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				// cleanQuery = "\\"; escapeLike -> "\\\\";
				// final pattern is "%\\\\%".
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%\\\\%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},
		{
			name:     "multiple rows returned",
			query:    "john",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-1", "john_doe", "John", "Doe", "http://a.com/1").
					AddRow("user-2", "johnny", "Johnny", "Doe", "").
					AddRow("user-3", "johnny_b", "Johnny", "Bravo", "http://a.com/3")
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%john%", "viewer-1").
					WillReturnRows(rows)
			},
			want: []user.SearchResult{
				{ID: "user-1", Username: "john_doe", FirstName: "John", LastName: "Doe", AvatarURL: "http://a.com/1"},
				{ID: "user-2", Username: "johnny", FirstName: "Johnny", LastName: "Doe", AvatarURL: ""},
				{ID: "user-3", Username: "johnny_b", FirstName: "Johnny", LastName: "Bravo", AvatarURL: "http://a.com/3"},
			},
			wantErr: false,
		},
		{
			name:     "no matches returns nil slice",
			query:    "nonexistent",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"})
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%nonexistent%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: false,
		},

		// --- Error paths ---

		{
			name:     "DB error",
			query:    "john",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%john%", "viewer-1").
					WillReturnError(errors.New("db error"))
			},
			want:    nil,
			wantErr: true,
		},
		{
			name:     "scan error",
			query:    "john",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-2", "john", "John", "Doe", "http://avatar.com/john").
					RowError(0, errors.New("scan error"))
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%john%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: true,
		},
		{
			name:     "NULL first_name results in scan error",
			query:    "john",
			viewerID: "viewer-1",
			mockExpect: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}).
					AddRow("user-2", "john", nil, "Doe", "")
				mock.ExpectQuery(regexp.QuoteMeta(searchSQL)).
					WithArgs("%john%", "viewer-1").
					WillReturnRows(rows)
			},
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("failed to create mock db: %v", err)
			}
			defer db.Close()

			tt.mockExpect(mock)

			s := user.NewService(db)

			got, err := s.Search(context.Background(), tt.viewerID, tt.query)

			if (err != nil) != tt.wantErr {
				t.Errorf("Search() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				if len(got) != len(tt.want) {
					t.Errorf("Search() got %d results, want %d", len(got), len(tt.want))
					return
				}
				for i := range got {
					if got[i] != tt.want[i] {
						t.Errorf("Search() got[%d] = %v, want %v", i, got[i], tt.want[i])
					}
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unmet expectations: %v", err)
			}
		})
	}
}

// TestEscapeLike verifies that SQL LIKE wildcards ('%', '_') and the
// escape character ('\') are correctly escaped, while ordinary
// characters (including '@') are preserved unchanged.
func TestEscapeLike(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		// Empty and ordinary strings.
		{name: "empty", input: "", want: ""},
		{name: "no special chars", input: "hello", want: "hello"},
		{name: "with @", input: "@john", want: "@john"},
		{name: "with spaces", input: "john doe", want: "john doe"},

		// Single special characters.
		{name: "single percent", input: "%", want: "\\%"},
		{name: "single underscore", input: "_", want: "\\_"},
		{name: "single backslash", input: "\\", want: "\\\\"},
		{name: "single at", input: "@", want: "@"},

		// Combinations.
		{name: "percent then underscore", input: "%_", want: "\\%\\_"},
		{name: "underscore then percent", input: "_%", want: "\\_\\%"},
		{name: "backslash then percent", input: "\\%", want: "\\\\\\%"},
		{name: "backslash then underscore", input: "\\_", want: "\\\\\\_"},
		{name: "all three", input: "\\%_", want: "\\\\\\%\\_"},
		{name: "all three reversed", input: "_%\\", want: "\\_\\%\\\\"},
		{name: "repeated percent", input: "%%%", want: "\\%\\%\\%"},
		{name: "repeated underscore", input: "___", want: "\\_\\_\\_"},
		{name: "repeated backslash", input: "\\\\\\", want: "\\\\\\\\\\\\"},

		// Real-world examples.
		{name: "username with underscore", input: "john_doe", want: "john\\_doe"},
		{name: "percent literal", input: "50%off", want: "50\\%off"},
		{name: "windows path", input: "C:\\Users\\john", want: "C:\\\\Users\\\\john"},
		{name: "already escaped percent", input: "\\%", want: "\\\\\\%"},

		{name: "cyrillic", input: "Иван", want: "Иван"},
		{name: "cyrillic with underscore", input: "Иван_Иванов", want: "Иван\\_Иванов"},
		{name: "emoji", input: "john🎉", want: "john🎉"},

		// '@' is not escaped.
		{name: "at in middle", input: "john@doe", want: "john@doe"},
		{name: "at with specials", input: "@%_\\", want: "@\\%\\_\\\\"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := user.EscapeLike(tt.input)
			if got != tt.want {
				t.Errorf("escapeLike(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// TestEscapeLikeOrder verifies the escaping order: backslash must be
// escaped first, otherwise it would escape the escape characters
// added by the subsequent replacements.
//
// Correct order: "\" -> "\\", then "%" -> "\%".
// Result for "\\%": "\\" + "\%" = "\\\\\%".
func TestEscapeLikeOrder(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "backslash before percent",
			input: "\\%",
			want:  "\\\\\\%", // "\\\\" + "\\%" = "\\\\\\%"
		},
		{
			name:  "percent before backslash",
			input: "%\\",
			want:  "\\%\\\\", // "\\%" + "\\\\" = "\\%\\\\"
		},
		{
			name:  "backslash before underscore",
			input: "\\_",
			want:  "\\\\\\_",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := user.EscapeLike(tt.input)
			if got != tt.want {
				t.Errorf("escapeLike(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

const statusSQLPattern = `(?s)FROM auth\.users.*LEFT JOIN users\.settings.*LEFT JOIN users\.presence.*WHERE auth\.users\.id = \$1 AND auth\.users\.disabled_at IS NULL`

func TestStatusReturnsNotFoundForMissingOrDisabledUser(t *testing.T) {
	tests := []struct {
		name   string
		userID string
	}{
		{name: "missing user", userID: "11111111-1111-4111-8111-111111111111"},
		{name: "disabled user", userID: "22222222-2222-4222-8222-222222222222"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			mock.ExpectQuery(statusSQLPattern).
				WithArgs(tt.userID, "viewer-1").
				WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "blocked", "exceptions", "last_active", "is_online"}))

			status, err := user.NewService(db).Status(context.Background(), "viewer-1", tt.userID)
			if !errors.Is(err, user.ErrNotFound) {
				t.Fatalf("expected ErrNotFound, got %v", err)
			}
			if status != nil {
				t.Fatalf("expected nil status, got %v", status)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStatusReturnsOfflineForExistingUserWithoutSessions(t *testing.T) {
	const userID = "33333333-3333-4333-8333-333333333333"

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db)
	mock.ExpectQuery(statusSQLPattern).
		WithArgs(userID, "viewer-1").
		WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "blocked", "exceptions", "last_active", "is_online"}).
			AddRow([]byte(`{}`), false, nil, nil, false))

	status, err := svc.Status(context.Background(), "viewer-1", userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status["isOnline"] != false || status["lastSeen"] != "" {
		t.Fatalf("unexpected status: %v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
