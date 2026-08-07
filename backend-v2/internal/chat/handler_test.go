package chat

import (
	"bytes"
	"craneapp/backend-v2/internal/platform/authctx"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestParseChatPath(t *testing.T) {
	chatID, suffix := parseChatPath("/api/v2/chats/abc-123/members")
	if chatID != "abc-123" || suffix != "/members" {
		t.Fatalf("unexpected parsed path: chatID=%q suffix=%q", chatID, suffix)
	}
}

func TestParseChatPathRejectsNonChatPath(t *testing.T) {
	chatID, suffix := parseChatPath("/api/v2/users/me")
	if chatID != "" || suffix != "" {
		t.Fatalf("expected empty parse result, got chatID=%q suffix=%q", chatID, suffix)
	}
}

func TestParseMemberAction(t *testing.T) {
	memberID, action := parseMemberAction("/members/user-2/role")
	if memberID != "user-2" || action != "/role" {
		t.Fatalf("unexpected member action: memberID=%q action=%q", memberID, action)
	}
}

// TestHandler_AddMember проверяет маппинг ответов сервиса в HTTP статусы и JSON-коды.
func TestHandler_AddMember(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := NewService(db, nil)
	h := NewHandler(svc)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	tests := []struct {
		name           string
		setupMock      func()
		expectedStatus int
		expectedCode   string
	}{
		{
			"Success",
			func() {
				// Все проверки проходят, вставка успешна
				mock.ExpectQuery(`SELECT role FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
				mock.ExpectQuery(`SELECT type FROM chats\.chats`).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
				mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectExec(`INSERT INTO chats\.members`).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectQuery(`SELECT .* FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "role", "permissions", "muted_until", "joined_at"}).AddRow(userID, "u", "A", "B", "", "member", "{}", "", time.Now().Format(time.RFC3339)))
			},
			http.StatusCreated, // 201
			"",
		},
		{
			"AlreadyMember",
			func() {
				mock.ExpectQuery(`SELECT role FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
				mock.ExpectQuery(`SELECT type FROM chats\.chats`).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
				mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"?"}).AddRow(true))
			},
			http.StatusConflict, // 409
			"already_member",
		},
		{
			"UserBanned",
			func() {
				mock.ExpectQuery(`SELECT role FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
				mock.ExpectQuery(`SELECT type FROM chats\.chats`).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
				mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).WillReturnRows(sqlmock.NewRows([]string{"?"}).AddRow(true))
			},
			http.StatusConflict, // 409
			"user_banned",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			body, _ := json.Marshal(map[string]string{"userId": userID})
			req := httptest.NewRequest(http.MethodPost, "/api/v2/chats/"+chatID+"/members", bytes.NewReader(body))

			// Оборачиваем запрос в контекст пользователя (актора)
			ctx := authctx.WithUser(req.Context(), authctx.User{ID: actorID})
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, rr.Code)
			}

			if tt.expectedCode != "" {
				var resp struct {
					Code string `json:"code"`
				}
				err := json.Unmarshal(rr.Body.Bytes(), &resp)
				if err != nil {
					t.Error(err)
				}
				if resp.Code != tt.expectedCode {
					t.Errorf("expected error code %q, got %q", tt.expectedCode, resp.Code)
				}
			}
		})
	}
}
