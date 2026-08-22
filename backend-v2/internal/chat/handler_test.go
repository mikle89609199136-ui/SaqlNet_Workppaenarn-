package chat

import (
	"bytes"
	"craneapp/backend-v2/internal/platform/authctx"
	"database/sql"
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

// TestHandler_LeaveChat проверяет маппинг LeaveChat-ошибок в HTTP статусы и JSON-коды.
func TestHandler_LeaveChat(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := NewService(db, nil)
	h := NewHandler(svc)

	userID := "550e8400-e29b-41d4-a716-446655440003"
	chatID := "550e8400-e29b-41d4-a716-446655440002"

	tests := []struct {
		name       string
		setupMock  func()
		wantStatus int
		wantCode   string
	}{
		{
			name: "success_member_200",
			setupMock: func() {
				mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
					WithArgs(userID, chatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
				mock.ExpectBegin()
				mock.ExpectQuery(`SELECT user_id FROM chats.members WHERE chat_id = $1`).
					WithArgs(chatID).
					WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(userID))
				mock.ExpectExec(`DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`).
					WithArgs(chatID, userID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(`DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`).
					WithArgs(userID, chatID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(`DELETE FROM chats.members WHERE chat_id=$1 AND user_id=$2 AND role<>'owner'`).
					WithArgs(chatID, userID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusOK,
			wantCode:   "", // success не требует code
		},
		{
			name: "owner_409_ownership_transfer_required",
			setupMock: func() {
				mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
					WithArgs(userID, chatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			},
			wantStatus: http.StatusConflict,
			wantCode:   "ownership_transfer_required",
		},
		{
			name: "not_member_403_access_denied",
			setupMock: func() {
				mock.ExpectQuery(`SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`).
					WithArgs(userID, chatID).
					WillReturnError(sql.ErrNoRows)
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "access_denied",
		},
		{
			name: "invalid_chatID_400_validation_failed",
			setupMock: func() {
				// SQL ожиданий нет — up-сайд
			},
			wantStatus: http.StatusBadRequest,
			wantCode:   "validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()
			idToUse := chatID
			if tt.name == "invalid_chatID_400_validation_failed" {
				idToUse = "not-a-uuid"
			}
			req := httptest.NewRequest(http.MethodPost, "/api/v2/chats/"+idToUse+"/leave", nil)
			ctx := authctx.WithUser(req.Context(), authctx.User{ID: userID})
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body %s", rr.Code, tt.wantStatus, rr.Body.String())
			}

			if tt.wantCode != "" {
				var body map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
					t.Fatalf("unmarshal: %v", err)
				}
				if body["code"] != tt.wantCode {
					t.Fatalf("error code = %q, want %q; body %s", body["code"], tt.wantCode, rr.Body.String())
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}

func TestHandler_TransferOwnership(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := NewService(db, nil)
	h := NewHandler(svc)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	targetID := "550e8400-e29b-41d4-a716-446655440003"

	tests := []struct {
		name           string
		userIDInBody   string // что положить в {"userId": ...}
		setupMock      func()
		expectedStatus int
		expectedCode   string
	}{
		{
			"Success",
			targetID,
			func() {
				mock.ExpectBegin()
				mock.ExpectQuery(`SELECT owner_id FROM chats.chats WHERE id = $1 FOR UPDATE`).
					WithArgs(chatID).
					WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(actorID))
				mock.ExpectQuery(`SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2 FOR UPDATE`).
					WithArgs(chatID, targetID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
				mock.ExpectExec(`UPDATE chats.chats SET owner_id = $1, updated_at = NOW() WHERE id = $2`).
					WithArgs(targetID, chatID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(`UPDATE chats.members SET role = 'owner' WHERE chat_id = $1 AND user_id = $2`).
					WithArgs(chatID, targetID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(`UPDATE chats.members SET role = 'member' WHERE chat_id = $1 AND user_id = $2`).
					WithArgs(chatID, actorID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			},
			http.StatusOK,
			"",
		},
		{
			"ActorNotOwner_409",
			targetID,
			func() {
				mock.ExpectBegin()
				mock.ExpectQuery(`SELECT owner_id FROM chats.chats WHERE id = $1 FOR UPDATE`).
					WithArgs(chatID).
					WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(targetID))
				mock.ExpectRollback()
			},
			http.StatusConflict,
			"ownership_conflict",
		},
		{
			"ChatNotFound_404",
			targetID,
			func() {
				mock.ExpectBegin()
				mock.ExpectQuery(`SELECT owner_id FROM chats.chats WHERE id = $1 FOR UPDATE`).
					WithArgs(chatID).
					WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
			},
			http.StatusNotFound,
			"chat_not_found",
		},
		{
			"TargetNotMember_400",
			targetID,
			func() {
				mock.ExpectBegin()
				mock.ExpectQuery(`SELECT owner_id FROM chats.chats WHERE id = $1 FOR UPDATE`).
					WithArgs(chatID).
					WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(actorID))
				mock.ExpectQuery(`SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2 FOR UPDATE`).
					WithArgs(chatID, targetID).
					WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
			},
			http.StatusBadRequest,
			"not_member",
		},
		{
			"SelfTransfer_400",
			actorID,   // цель = актор
			func() {}, // SQL-ожиданий нет — сервис отвергнет раньше
			http.StatusBadRequest,
			"validation_failed",
		},
		{
			"InvalidUUID_400",
			"not-a-uuid",
			func() {},
			http.StatusBadRequest,
			"validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			body, _ := json.Marshal(map[string]string{"userId": tt.userIDInBody})
			req := httptest.NewRequest(http.MethodPost, "/api/v2/chats/"+chatID+"/transfer-ownership", bytes.NewReader(body))

			ctx := authctx.WithUser(req.Context(), authctx.User{ID: actorID})
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d, body %s", tt.expectedStatus, rr.Code, rr.Body.String())
			}
			if tt.expectedCode != "" {
				var resp struct {
					Code string `json:"code"`
				}
				_ = json.Unmarshal(rr.Body.Bytes(), &resp)
				if resp.Code != tt.expectedCode {
					t.Errorf("expected code %q, got %q; body %s", tt.expectedCode, resp.Code, rr.Body.String())
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}
