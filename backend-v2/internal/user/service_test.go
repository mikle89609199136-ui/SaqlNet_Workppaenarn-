package user_test

import (
	"context"
	"craneapp/backend-v2/internal/user"
	"database/sql"
	"database/sql/driver"
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
//
// Display fields (first_name, last_name, avatar_url) and bio are read
// from users.profiles, the single source of truth. auth.users.first_name
// / last_name are a registration snapshot and are not used here; there
// is no COALESCE fallback anymore, and the JOIN to profiles is an inner
// join because every user is guaranteed to have a profile row (trigger
// at registration + backfill migration + ensureProfile safety net).
const searchSQL = `
		SELECT au.id::text, au.username,
		       up.first_name, up.last_name, up.avatar_url
		FROM auth.users au
		JOIN users.profiles up ON up.user_id = au.id
		WHERE au.disabled_at IS NULL
		  AND au.id::text != $2
		  AND (au.username   ILIKE $1 OR
		       up.first_name ILIKE $1 OR
		       up.last_name  ILIKE $1 OR
		       up.bio        ILIKE $1)
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
			// Defensive: users.profiles.first_name is NOT NULL in the schema,
			// so in production this cannot happen. The test still guards the
			// scan loop against a NULL slipping through (e.g. a future
			// migration relaxing the constraint, or a mocked/stubbed row).
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

const statusSQLPattern = `(?s)FROM auth\.users.*LEFT JOIN users\.settings.*LEFT JOIN LATERAL.*FROM public\.user_sessions.*WHERE auth\.users\.id = \$1 AND auth\.users\.disabled_at IS NULL`

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
				WithArgs(tt.userID).
				WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "last_active", "is_online"}))

			status, err := user.NewService(db).Status(context.Background(), tt.userID)
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
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "last_active", "is_online"}).
			AddRow([]byte(`{}`), nil, false))

	status, err := svc.Status(context.Background(), userID)
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

//---------- Tests for UpdateProfile service method -------------------------

// SQL patterns shared by the mocks.
//
// UpdateProfile now runs inside a transaction:
//
//	BeginTx → ensureProfile (Exec) → UPDATE (Exec) → Commit → reload (Query)
//
// so every test must announce ExpectBegin / ExpectCommit (or ExpectRollback
// on failure) in addition to the statement-level expectations below.
const (
	ensureProfilePattern = "INSERT INTO users.profiles"
	updateProfilePattern = "UPDATE users.profiles SET"
	reloadProfilePattern = "SELECT au.id::text, au.username"
)

// strptr — convenience for taking the address of a string literal.
func strptr(s string) *string { return &s }

// contains — small helper; kept here because the same assertion is used
// across several tests and the production package does not export one.
func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

// expectEnsureProfile expects the create-on-demand INSERT performed by
// ensureProfile before the UPDATE.
func expectEnsureProfile(mock sqlmock.Sqlmock, userID string) {
	mock.ExpectExec(ensureProfilePattern).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 0))
}

// expectUpdateProfile expects the UPDATE with the given $2..$5 arguments.
// These arguments are exactly stringOrNil(...) of the *string parameters.
//
// NOTE: this helper asserts argument pass-through only. It does not
// verify the SQL body, so it cannot detect a regression in the
// COALESCE(NULLIF(...)) clauses. Use expectUpdateProfileAllNullif for
// tests that need to pin down the field semantics.
func expectUpdateProfile(mock sqlmock.Sqlmock, userID string, fn, ln, bio, av any) {
	mock.ExpectExec(updateProfilePattern).
		WithArgs(userID, fn, ln, bio, av).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

// updateProfileAllNullifRe matches the exact UPDATE used by UpdateProfile,
// including the COALESCE(NULLIF($n, ”), col) clauses on every optional
// text field. This is what actually pins down "empty string = no-op":
// expectUpdateProfile (args-only) would stay green if someone reverted any
// of the NULLIFs to a bare COALESCE.
//
// The regexp is whitespace-tolerant but column-order- and clause-shape-
// sensitive; it will need updating if the UPDATE is refactored.
var updateProfileAllNullifRe = regexp.MustCompile(
	`(?s)UPDATE\s+users\.profiles\s+SET\s+` +
		`first_name\s*=\s*COALESCE\(NULLIF\(\$2,\s*''\),\s*first_name\),\s*` +
		`last_name\s*=\s*COALESCE\(NULLIF\(\$3,\s*''\),\s*last_name\),\s*` +
		`bio\s*=\s*COALESCE\(NULLIF\(\$4,\s*''\),\s*bio\),\s*` +
		`avatar_url\s*=\s*COALESCE\(NULLIF\(\$5,\s*''\),\s*avatar_url\),\s*` +
		`updated_at\s*=\s*NOW\(\)\s+WHERE\s+user_id\s*=\s*\$1`,
)

func expectUpdateProfileAllNullif(mock sqlmock.Sqlmock, userID string, fn, ln, bio, av any) {
	mock.ExpectExec(updateProfileAllNullifRe.String()).
		WithArgs(userID, fn, ln, bio, av).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

// expectReloadProfile expects the SELECT performed by profileByID after a
// successful UPDATE, and returns the given row. The reload runs on the
// service's *sql.DB (outside the transaction), so no Begin/Commit wrapper
// is needed here — the caller is responsible for ExpectBegin/ExpectCommit
// around the two Execs.
func expectReloadProfile(mock sqlmock.Sqlmock, userID string, row []driver.Value) {
	mock.ExpectQuery(reloadProfilePattern).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "first_name", "last_name",
			"bio", "avatar_url", "badges", "is_premium",
		}).AddRow(row...))
}

// TestUpdateProfile_FirstNameRoundTrip is a regression test for the bug where
// "after PUT /me, a search by the old first name still finds the user".
//
// At the service layer this means: the new first_name must be sent to the
// UPDATE statement ($2), and the value returned by UpdateProfile must equal
// what the reload (profileByID) yields. users.profiles is now the single
// source of truth for first_name, so there is no longer any stale
// auth.users field for the service to accidentally mix in — the reload is
// the only path that produces the returned value.
func TestUpdateProfile_FirstNameRoundTrip(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db)

	// Transaction opened by UpdateProfile: INSERT → UPDATE → COMMIT, then
	// the SELECT that produces the returned profile.
	mock.ExpectBegin()
	expectEnsureProfile(mock, "user-1")
	expectUpdateProfile(mock, "user-1", "UniqueSearchName260831", nil, nil, nil)
	mock.ExpectCommit()
	expectReloadProfile(mock, "user-1", []driver.Value{
		"user-1", "ivan",
		"UniqueSearchName260831", "Auditb",
		"", "", "{}", false,
	})

	got, err := svc.UpdateProfile(context.Background(), "user-1",
		strptr("UniqueSearchName260831"), nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The returned profile must reflect the newly written first_name.
	if got.FirstName != "UniqueSearchName260831" {
		t.Fatalf("FirstName = %q, want %q", got.FirstName, "UniqueSearchName260831")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestUpdateProfile_FieldSemantics pins down that an empty string means
// "do not change" for every optional text field: first_name, last_name,
// bio, avatar_url.
//
// The service forwards its arguments to the UPDATE verbatim via
// stringOrNil (nil -> NULL, "" -> ”, non-empty -> as-is); the actual
// "empty means no-op" behavior lives in the SQL, in the form of
// COALESCE(NULLIF($n, ”), col). To keep a regression from silently
// reintroducing the old asymmetric behavior (empty lastName overwrites),
// the UPDATE expectation matches the NULLIF clauses themselves, not just
// the argument list.
func TestUpdateProfile_FieldSemantics(t *testing.T) {
	tests := []struct {
		name       string
		firstName  *string
		lastName   *string
		bio        *string
		avatarURL  *string
		wantFnArg  any
		wantLnArg  any
		wantBioArg any
		wantAvArg  any
	}{
		{
			name:      "nil firstName is a no-op",
			firstName: nil,
			wantFnArg: nil, wantLnArg: nil, wantBioArg: nil, wantAvArg: nil,
		},
		{
			name:      "empty firstName is a no-op",
			firstName: strptr(""),
			wantFnArg: "", wantLnArg: nil, wantBioArg: nil, wantAvArg: nil,
		},
		{
			name:      "non-empty firstName is passed through",
			firstName: strptr("Ivan"),
			wantFnArg: "Ivan", wantLnArg: nil, wantBioArg: nil, wantAvArg: nil,
		},
		{
			name:      "nil lastName is a no-op",
			lastName:  nil,
			wantFnArg: nil, wantLnArg: nil, wantBioArg: nil, wantAvArg: nil,
		},
		{
			name:      "empty lastName is a no-op",
			lastName:  strptr(""),
			wantFnArg: nil, wantLnArg: "", wantBioArg: nil, wantAvArg: nil,
		},
		{
			name:      "non-empty lastName is passed through",
			lastName:  strptr("Petrov"),
			wantFnArg: nil, wantLnArg: "Petrov", wantBioArg: nil, wantAvArg: nil,
		},
		{
			name:      "empty bio is a no-op",
			bio:       strptr(""),
			wantFnArg: nil, wantLnArg: nil, wantBioArg: "", wantAvArg: nil,
		},
		{
			name:      "empty avatarUrl is a no-op",
			avatarURL: strptr(""),
			wantFnArg: nil, wantLnArg: nil, wantBioArg: nil, wantAvArg: "",
		},
		{
			name:      "all fields set",
			firstName: strptr("Ivan"),
			lastName:  strptr("Petrov"),
			bio:       strptr("hello"),
			avatarURL: strptr("http://a/x.png"),
			wantFnArg: "Ivan", wantLnArg: "Petrov",
			wantBioArg: "hello", wantAvArg: "http://a/x.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			svc := user.NewService(db)

			mock.ExpectBegin()
			expectEnsureProfile(mock, "user-1")
			expectUpdateProfileAllNullif(mock, "user-1",
				tt.wantFnArg, tt.wantLnArg, tt.wantBioArg, tt.wantAvArg)
			mock.ExpectCommit()
			// The contents of the reloaded row are irrelevant here;
			// only the fact that reload happens is asserted.
			expectReloadProfile(mock, "user-1", []driver.Value{
				"user-1", "ivan", "Ivan", "", "", "", "{}", false,
			})

			_, err = svc.UpdateProfile(context.Background(), "user-1",
				tt.firstName, tt.lastName, tt.bio, tt.avatarURL)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestUpdateProfile_EnsureProfileError verifies that an error from
// ensureProfile aborts execution before the UPDATE and before the reload.
//
// The transaction is opened before ensureProfile, so the deferred
// tx.Rollback() is expected; the UPDATE and the SELECT are intentionally
// not expected, and ExpectationsWereMet below confirms they were never
// issued.
func TestUpdateProfile_EnsureProfileError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db)

	mock.ExpectBegin()
	mock.ExpectExec(ensureProfilePattern).
		WithArgs("user-1").
		WillReturnError(errors.New("insert failed"))
	mock.ExpectRollback()

	_, err = svc.UpdateProfile(context.Background(), "user-1",
		strptr("Ivan"), nil, nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestUpdateProfile_UpdateError verifies that an error from the UPDATE
// prevents the reload from being called.
//
// The transaction is rolled back because Commit is never reached; the
// SELECT is intentionally not expected.
func TestUpdateProfile_UpdateError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db)

	mock.ExpectBegin()
	expectEnsureProfile(mock, "user-1")
	mock.ExpectExec(updateProfilePattern).
		WithArgs("user-1", "Ivan", nil, nil, nil).
		WillReturnError(errors.New("update failed"))
	mock.ExpectRollback()

	_, err = svc.UpdateProfile(context.Background(), "user-1",
		strptr("Ivan"), nil, nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestUpdateProfile_ReloadError verifies that when the UPDATE succeeds but
// re-reading the profile fails, the service surfaces the error instead of
// masking it.
//
// The reload runs after Commit, outside the transaction, so no Rollback is
// expected here.
func TestUpdateProfile_ReloadError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db)

	mock.ExpectBegin()
	expectEnsureProfile(mock, "user-1")
	expectUpdateProfile(mock, "user-1", "Ivan", nil, nil, nil)
	mock.ExpectCommit()
	mock.ExpectQuery(reloadProfilePattern).
		WithArgs("user-1").
		WillReturnError(errors.New("select failed"))

	_, err = svc.UpdateProfile(context.Background(), "user-1",
		strptr("Ivan"), nil, nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestUpdateProfile_ReturnsDerivedFields verifies that the response of
// UpdateProfile carries the same derived fields as profileByID returns:
// IsBot is set from the "bot" badge, and "premium" is appended when
// is_premium is TRUE.
//
// No additional logic on top of the reload is expected.
func TestUpdateProfile_ReturnsDerivedFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	svc := user.NewService(db)

	mock.ExpectBegin()
	expectEnsureProfile(mock, "user-1")
	expectUpdateProfile(mock, "user-1", "Ivan", nil, nil, nil)
	mock.ExpectCommit()
	expectReloadProfile(mock, "user-1", []driver.Value{
		"user-1", "ivan", "Ivan", "",
		"", "", "{bot}", true,
	})

	got, err := svc.UpdateProfile(context.Background(), "user-1",
		strptr("Ivan"), nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got.IsBot {
		t.Fatal("expected IsBot=true derived from bot badge")
	}
	if !got.IsPremium {
		t.Fatal("expected IsPremium=true")
	}
	if !contains(got.Badges, "premium") {
		t.Fatalf("expected premium badge appended, got %v", got.Badges)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
