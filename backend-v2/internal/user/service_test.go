package user_test

import (
	"context"
	"craneapp/backend-v2/internal/user"
	"errors"
	"regexp"
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
	if !errors.Is(err, user.ErrInvalidUsernameFormat) {
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

			s := &user.Service{Db: db}

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
