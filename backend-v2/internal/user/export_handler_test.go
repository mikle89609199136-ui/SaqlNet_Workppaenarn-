package user

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/DATA-DOG/go-sqlmock"
)

// TestExport_FullShapeIncludesAllSections verifies that GET /users/export
// returns every section of the export contract with populated collections:
// messages in chronological order, media with sizes, devices with the
// current-session flag, blocked users, the full settings snapshot and the
// flat privacy alias.
func TestExport_FullShapeIncludesAllSections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`(?s)SELECT au\.id::text, au\.username.*FROM auth\.users au`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "first_name", "last_name", "bio", "avatar_url", "badges", "is_premium",
		}).AddRow("user-id", "alice", "Alice", "Smith", "", "", "{}", false))
	mock.ExpectExec(`INSERT INTO users\.settings`).
		WithArgs("user-id").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings, folders, passcode_enabled, passcode_timeout FROM users\.settings`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{
			"settings", "privacy_settings", "notification_settings", "sound_settings",
			"storage_settings", "advanced_settings", "folders", "passcode_enabled", "passcode_timeout",
		}).AddRow([]byte(`{}`), []byte(`{"calls":"nobody"}`), []byte(`{}`), []byte(`{}`), []byte(`{}`), []byte(`{}`), []byte(`[]`), true, 300))
	mock.ExpectQuery(`(?s)SELECT c\.id::text, c\.title, c\.type, c\.created_at::text.*FROM chats\.chats`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "type", "created_at"}).
			AddRow("chat-1", "Trip", "group", "2026-01-01 09:00:00+00"))
	mock.ExpectQuery(`(?s)SELECT m\.id::text, m\.chat_id::text, m\.content, m\.type, m\.created_at::text, m\.updated_at::text.*FROM messages\.messages m.*WHERE m\.sender_id = \$1 AND m\.deleted_at IS NULL.*ORDER BY m\.created_at ASC`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "content", "type", "created_at", "updated_at"}).
			AddRow("msg-1", "chat-1", "first", "text", "2026-01-01 10:00:00+00", "2026-01-01 10:00:00+00").
			AddRow("msg-2", "chat-1", "second", "text", "2026-01-02 11:00:00+00", "2026-01-02 11:00:00+00"))
	mock.ExpectQuery(`(?s)SELECT s\.id::text.*FROM auth\.sessions s`).
		WithArgs("user-id", authctx.TokenHash("caller-token")).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "device_name", "device_type", "ip_address", "last_active", "created_at",
			"location", "user_agent", "is_current",
		}).AddRow("session-1", "Pixel 8", "mobile", "203.0.113.10",
			time.Date(2026, 1, 4, 8, 30, 0, 0, time.UTC),
			time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC),
			"Minsk", "TestAgent/1.0", true))
	mock.ExpectQuery(`(?s)SELECT au\.id::text, au\.username.*FROM users\.blocked_users`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "blocked_at"}).
			AddRow("blocked-1", "bob", "Bob", "", "", "2026-01-02 09:00:00+00"))
	mock.ExpectQuery(`(?s)SELECT id::text, filename, content_type, size_bytes, created_at::text.*FROM media\.uploads.*WHERE uploader_id = \$1.*ORDER BY created_at ASC`).
		WithArgs("user-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "filename", "content_type", "size_bytes", "created_at"}).
			AddRow("media-1", "report.pdf", "application/pdf", int64(12345), "2026-01-03 12:00:00+00"))

	handler := NewHandler(NewService(db), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/users/export", nil)
	request.AddCookie(&http.Cookie{Name: authctx.SessionCookieName(), Value: "caller-token"})
	request = request.WithContext(authctx.WithUser(request.Context(), authctx.User{ID: "user-id"}))
	response := httptest.NewRecorder()

	handler.Export(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}

	var got struct {
		Messages []struct {
			ID        string `json:"id"`
			ChatID    string `json:"chatId"`
			Content   string `json:"content"`
			Type      string `json:"type"`
			CreatedAt string `json:"createdAt"`
			UpdatedAt string `json:"updatedAt"`
		} `json:"messages"`
		Media []struct {
			ID          string `json:"id"`
			Filename    string `json:"filename"`
			ContentType string `json:"contentType"`
			SizeBytes   int64  `json:"sizeBytes"`
			CreatedAt   string `json:"createdAt"`
		} `json:"media"`
		Devices []struct {
			ID         string `json:"id"`
			DeviceName string `json:"deviceName"`
			IsCurrent  bool   `json:"isCurrent"`
		} `json:"devices"`
		Blocked []struct {
			ID        string `json:"id"`
			AvatarURL string `json:"avatarUrl"`
		} `json:"blocked"`
		Settings      map[string]json.RawMessage `json:"settings"`
		Privacy       map[string]json.RawMessage `json:"privacy"`
		ExportedAt    string                     `json:"exportedAt"`
		SchemaVersion int                        `json:"schemaVersion"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode export: %v; body: %s", err, response.Body.String())
	}

	if got.SchemaVersion != 2 {
		t.Fatalf("expected schemaVersion 2, got %d", got.SchemaVersion)
	}
	if len(got.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %+v", len(got.Messages), got.Messages)
	}
	if got.Messages[0].ID != "msg-1" || got.Messages[1].ID != "msg-2" {
		t.Fatalf("messages out of order: %+v", got.Messages)
	}
	if got.Messages[0].Content != "first" {
		t.Fatalf("expected first message content %q, got %q", "first", got.Messages[0].Content)
	}
	if len(got.Media) != 1 {
		t.Fatalf("expected 1 media item, got %d", len(got.Media))
	}
	if got.Media[0].Filename != "report.pdf" || got.Media[0].ContentType != "application/pdf" || got.Media[0].SizeBytes != 12345 {
		t.Fatalf("unexpected media item: %+v", got.Media[0])
	}
	if len(got.Devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(got.Devices))
	}
	if !got.Devices[0].IsCurrent {
		t.Fatalf("expected the only device to be current: %+v", got.Devices[0])
	}
	if got.Devices[0].DeviceName == "" {
		t.Fatalf("expected device name to be set: %+v", got.Devices[0])
	}
	if len(got.Blocked) != 1 {
		t.Fatalf("expected 1 blocked user, got %d", len(got.Blocked))
	}
	if got.Blocked[0].AvatarURL != "" {
		t.Fatalf("expected empty avatarUrl for blocked user, got %q", got.Blocked[0].AvatarURL)
	}
	for _, key := range []string{
		"settings", "privacySettings", "notificationSettings", "soundSettings",
		"storageSettings", "advancedSettings", "folders", "passcodeEnabled", "passcodeTimeout",
	} {
		if _, ok := got.Settings[key]; !ok {
			t.Fatalf("settings is missing key %q: %s", key, response.Body.String())
		}
	}
	if got.Privacy == nil {
		t.Fatal("privacy must not be null")
	}
	calls, ok := got.Privacy["calls"]
	if !ok {
		t.Fatalf("privacy is missing key %q: %s", "calls", response.Body.String())
	}
	if string(calls) != `"nobody"` {
		t.Fatalf("expected privacy.calls %q, got %s", "nobody", calls)
	}
	if _, err := time.Parse(time.RFC3339, got.ExportedAt); err != nil {
		t.Fatalf("exportedAt is not RFC 3339: %v (%q)", err, got.ExportedAt)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
