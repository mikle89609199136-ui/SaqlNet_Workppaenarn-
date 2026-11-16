package user

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSearch_NoMatchesSerializedAsArray(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`(?s)SELECT au\.id::text, au\.username.*FROM auth\.users au`).
		WithArgs("%UniqueSearchName268831%", "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url"}))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/search?q=UniqueSearchName268831", nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Search(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	raw := strings.TrimSpace(response.Body.String())
	if strings.Contains(raw, `"users":null`) {
		t.Fatalf("users must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"users":[]`) {
		t.Fatalf("expected users to be an empty JSON array; got: %s", raw)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSearch_BlankQuerySerializedAsArray(t *testing.T) {
	handler := NewHandler(NewService(nil), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/search?q=", nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Search(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	raw := strings.TrimSpace(response.Body.String())
	if strings.Contains(raw, `"users":null`) || !strings.Contains(raw, `"users":[]`) {
		t.Fatalf("expected users:[]; got: %s", raw)
	}
}

func TestBlocked_EmptyListSerializedAsArray(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`(?s)SELECT au\.id::text, au\.username.*FROM users\.blocked_users`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "blocked_at"}))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/blocked", nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Blocked(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	raw := strings.TrimSpace(response.Body.String())
	if strings.Contains(raw, `"blocked":null`) {
		t.Fatalf("blocked must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"blocked":[]`) {
		t.Fatalf("expected blocked to be an empty JSON array; got: %s", raw)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExport_NoChatsSerializedAsArray(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`(?s)SELECT au\.id::text, au\.username.*FROM auth\.users au`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "first_name", "last_name", "bio", "avatar_url", "badges", "is_premium",
		}).AddRow("user-id", "alice", "Alice", "", "", "", "{}", false))
	mock.ExpectExec(`INSERT INTO users\.settings`).
		WithArgs("user-id").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings, folders, passcode_enabled, passcode_timeout FROM users\.settings`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{
			"settings", "privacy_settings", "notification_settings", "sound_settings",
			"storage_settings", "advanced_settings", "folders", "passcode_enabled", "passcode_timeout",
		}).AddRow([]byte(`{}`), []byte(`{}`), []byte(`{}`), []byte(`{}`), []byte(`{}`), []byte(`{}`), []byte(`[]`), false, 0))
	mock.ExpectQuery(`(?s)SELECT c\.id::text, c\.title, c\.type, c\.created_at::text.*FROM chats\.chats`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "type", "created_at"}))
	mock.ExpectQuery(`(?s)SELECT m\.id::text, m\.chat_id::text, m\.content, m\.type, m\.created_at::text, m\.updated_at::text.*FROM messages\.messages m.*WHERE m\.sender_id = \$1 AND m\.deleted_at IS NULL.*ORDER BY m\.created_at ASC`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "content", "type", "created_at", "updated_at"}))
	mock.ExpectQuery(`(?s)SELECT s\.id::text.*FROM auth\.sessions s`).
		WithArgs("user-id", "").
		WillReturnRows(sqlmock.NewRows([]string{"id", "device_name", "device_type", "ip_address", "last_active", "created_at", "location", "user_agent", "is_current"}))
	mock.ExpectQuery(`(?s)SELECT au\.id::text, au\.username.*FROM users\.blocked_users`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "blocked_at"}))
	mock.ExpectQuery(`(?s)SELECT id::text, filename, content_type, size_bytes, created_at::text.*FROM media\.uploads.*WHERE uploader_id = \$1.*ORDER BY created_at ASC`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "filename", "content_type", "size_bytes", "created_at"}))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/export", nil)
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Export(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	raw := strings.TrimSpace(response.Body.String())
	if strings.Contains(raw, `"chats":null`) {
		t.Fatalf("chats must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"chats":[]`) {
		t.Fatalf("expected chats to be an empty JSON array; got: %s", raw)
	}
	if strings.Contains(raw, `"messages":null`) {
		t.Fatalf("messages must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"messages":[]`) {
		t.Fatalf("expected messages to be an empty JSON array; got: %s", raw)
	}
	if strings.Contains(raw, `"media":null`) {
		t.Fatalf("media must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"media":[]`) {
		t.Fatalf("expected media to be an empty JSON array; got: %s", raw)
	}
	if strings.Contains(raw, `"devices":null`) {
		t.Fatalf("devices must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"devices":[]`) {
		t.Fatalf("expected devices to be an empty JSON array; got: %s", raw)
	}
	if strings.Contains(raw, `"blocked":null`) {
		t.Fatalf("blocked must not be null; got: %s", raw)
	}
	if !strings.Contains(raw, `"blocked":[]`) {
		t.Fatalf("expected blocked to be an empty JSON array; got: %s", raw)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
