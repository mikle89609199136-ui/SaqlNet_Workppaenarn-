package chat

import (
	"bytes"
	"context"
	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/presence"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// Тестовые UUID — валидные, чтобы не срабатывала валидация входных данных.
const (
	handlerActorID  = "550e8400-e29b-41d4-a716-446655440001"
	handlerChatID   = "550e8400-e29b-41d4-a716-446655440002"
	handlerTargetID = "550e8400-e29b-41d4-a716-446655440003"
)

// SQL-ожидания, повторяющиеся в нескольких тестах.
const (
	memberRoleQuery = `SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2`
	// actorChatInfoQuery — точная копия SQL getChatInfo: тип чата и роль
	// актора одним запросом. Используется moderation-методами (mute/ban/...),
	// которые после правки №1 проверяют chats.chats.type = 'group'.
	actorChatInfoQuery = `SELECT c.type, cm.role
		FROM chats.chats c JOIN chats.members cm ON cm.chat_id = c.id WHERE c.id = $2 AND cm.user_id = $1`
	memberRoleLockQuery   = `SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2 FOR UPDATE`
	ownerLockQuery        = `SELECT owner_id, type FROM chats.chats WHERE id = $1 FOR UPDATE`
	leaveMemberListQuery  = `SELECT user_id FROM chats.members WHERE chat_id = $1`
	leaveKeysDelete       = `DELETE FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`
	leaveSettingsDelete   = `DELETE FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2`
	leaveMembershipDelete = `DELETE FROM chats.members WHERE chat_id=$1 AND user_id=$2 AND role<>'owner'`
	// sendMessageMuteQuery — точная копия SQL проверки mute в Service.SendMessage.
	sendMessageMuteQuery = `
	SELECT cm.role,
	       (
	         COALESCE(u.is_muted AND (u.muted_until IS NULL OR u.muted_until > NOW()), false) OR
	         (cm.muted_at IS NOT NULL AND (cm.muted_until IS NULL OR cm.muted_until > NOW()))
	       )
	FROM chats.members cm
	JOIN auth.users u ON u.id = cm.user_id
	WHERE cm.chat_id = $1 AND cm.user_id = $2
	`
	// muteMemberSelectQuery — точная копия SQL чтения состояния цели в Service.MuteMember.
	muteMemberTargetQuery = `
		SELECT role, muted_at, muted_until FROM chats.members WHERE user_id = $1 AND chat_id = $2
		`
	// banTargetRoleQuery — точная копия SQL чтения роли цели в Service.BanMember
	// (с переносами и отступами, как в service.go).
	banTargetRoleQuery = `
		SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2
		`
	banSelectQuery       = `SELECT banned_until, reason FROM chats.bans WHERE chat_id = $1 AND user_id = $2`
	banInsertQuery       = `INSERT INTO chats.bans (chat_id, user_id, banned_by, reason, banned_until) VALUES ($1, $2, $3, $4, $5)`
	onlineTypeQuery      = `SELECT type FROM chats.chats WHERE id = $1`
	onlineMemberIDsQuery = `SELECT user_id::text FROM chats.members WHERE chat_id = $1`
)

// newTestHandler собирает Handler на sqlmock с точным совпадением SQL.
func newTestHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewHandler(NewService(db, nil, nil)), mock
}

// newAuthedRequest создаёт запрос с контекстом пользователя-актора.
func newAuthedRequest(method, url string, body []byte, userID string) *http.Request {
	req := httptest.NewRequest(method, url, bytes.NewReader(body))
	return req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: userID}))
}

// assertErrorResponse проверяет HTTP-статус и JSON-код ошибки.
// wantCode == "" означает успешный ответ без поля code.
func assertErrorResponse(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if rr.Code != wantStatus {
		t.Errorf("status = %d, want %d, body %s", rr.Code, wantStatus, rr.Body.String())
	}
	if wantCode == "" {
		return
	}
	var resp struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Errorf("unmarshal error body: %v", err)
	}
	if resp.Code != wantCode {
		t.Errorf("error code = %q, want %q; body %s", resp.Code, wantCode, rr.Body.String())
	}
}

// expectOwnerLock мокирует SELECT ... FOR UPDATE по chats.chats с заданным owner_id.
func expectOwnerLock(mock sqlmock.Sqlmock, ownerID string) {
	mock.ExpectQuery(ownerLockQuery).
		WithArgs(handlerChatID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id", "type"}).AddRow(ownerID, "group"))
}

// expectTargetLock мокирует SELECT ... FOR UPDATE по membership-строке target (роль member).
func expectTargetLock(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(memberRoleLockQuery).
		WithArgs(handlerChatID, handlerTargetID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
}

// expectAddMemberPrechecks мокирует общие проверки AddMember:
// актор — owner, чат типа group, пользователь существует.
// (regex-матчер: точный SQL AddMember уже зафиксирован в add_member_test.go)
func expectAddMemberPrechecks(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`SELECT role FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT type FROM chats\.chats`).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
}

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

	svc := NewService(db, nil, nil)
	h := NewHandler(svc)

	tests := []struct {
		name       string
		setupMock  func()
		wantStatus int
		wantCode   string
	}{
		{
			"Success",
			func() {
				// Все проверки проходят, вставка успешна
				expectAddMemberPrechecks(mock)
				mock.ExpectBegin()
				mock.ExpectQuery(`pg_advisory_xact_lock`).WillReturnRows(sqlmock.NewRows([]string{"pg_advisory_xact_lock"}).AddRow(nil))
				mock.ExpectExec(`INSERT INTO chats\.members`).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectQuery(`SELECT .* FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "role", "permissions", "muted_until", "muted_at", "joined_at"}).AddRow(handlerTargetID, "u", "A", "B", "", "member", "{}", "", time.Now().Format(time.RFC3339), time.Now().Format(time.RFC3339)))
				mock.ExpectCommit()
			},
			http.StatusCreated, // 201
			"",
		},
		{
			"AlreadyMember",
			func() {
				expectAddMemberPrechecks(mock)
				mock.ExpectBegin()
				mock.ExpectQuery(`pg_advisory_xact_lock`).WillReturnRows(sqlmock.NewRows([]string{"pg_advisory_xact_lock"}).AddRow(nil))
				// Вставка не сработала — различаем причину: бана нет, membership есть
				mock.ExpectExec(`INSERT INTO chats\.members`).WillReturnResult(sqlmock.NewResult(0, 0))
				mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectRollback()
			},
			http.StatusConflict, // 409
			"already_member",
		},
		{
			"UserBanned",
			func() {
				expectAddMemberPrechecks(mock)
				mock.ExpectBegin()
				mock.ExpectQuery(`pg_advisory_xact_lock`).WillReturnRows(sqlmock.NewRows([]string{"pg_advisory_xact_lock"}).AddRow(nil))
				mock.ExpectExec(`INSERT INTO chats\.members`).WillReturnResult(sqlmock.NewResult(0, 0))
				// Активный бан — причина найдена сразу, membership не проверяем
				mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectRollback()
			},
			http.StatusConflict, // 409
			"user_banned",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			body, _ := json.Marshal(map[string]string{"userId": handlerTargetID})
			req := newAuthedRequest(http.MethodPost, "/api/v2/chats/"+handlerChatID+"/members", body, handlerActorID)

			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}

// TestHandler_LeaveChat проверяет маппинг LeaveChat-ошибок в HTTP статусы и JSON-коды.
func TestHandler_LeaveChat(t *testing.T) {
	h, mock := newTestHandler(t)

	tests := []struct {
		name           string
		setupMock      func()
		wantStatus     int
		wantCode       string
		chatIDOverride string // если задан — подставляется в URL вместо handlerChatID
	}{
		{
			name: "success_member_200",
			setupMock: func() {
				mock.ExpectQuery(memberRoleQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
				mock.ExpectBegin()
				mock.ExpectQuery(leaveMemberListQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(handlerActorID))
				mock.ExpectExec(leaveKeysDelete).
					WithArgs(handlerChatID, handlerActorID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(leaveSettingsDelete).
					WithArgs(handlerActorID, handlerChatID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(leaveMembershipDelete).
					WithArgs(handlerChatID, handlerActorID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusOK,
			wantCode:   "", // success не требует code
		},
		{
			name: "owner_409_ownership_transfer_required",
			setupMock: func() {
				mock.ExpectQuery(memberRoleQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			},
			wantStatus: http.StatusConflict,
			wantCode:   "ownership_transfer_required",
		},
		{
			name: "not_member_403_access_denied",
			setupMock: func() {
				mock.ExpectQuery(memberRoleQuery).
					WithArgs(handlerActorID, handlerChatID).
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
			wantStatus:     http.StatusBadRequest,
			wantCode:       "validation_failed",
			chatIDOverride: "not-a-uuid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()
			chatID := handlerChatID
			if tt.chatIDOverride != "" {
				chatID = tt.chatIDOverride
			}
			req := newAuthedRequest(http.MethodPost, "/api/v2/chats/"+chatID+"/leave", nil, handlerActorID)

			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}

// TestHandler_TransferOwnership проверяет HTTP-контракт эндпоинта POST /api/v2/chats/{chatId}/transfer-ownership:
// - Success: успешная передача владения в групповом чате возвращает 200 OK;
// - ActorNotOwner_409: актор не является владельцем чата — возвращает 409 Conflict (ownership_conflict);
// - ChatNotFound_404: чат не существует — возвращает 404 Not Found (chat_not_found);
// - TargetNotMember_400: целевой пользователь не состоит в чате — возвращает 400 Bad Request (not_member);
// - SelfTransfer_400: попытка передачи владения самому себе — отклоняется с 400 Bad Request (validation_failed);
// - InvalidUUID_400: невалидный формат UUID — отклоняется с 400 Bad Request (validation_failed);
// - PrivateChat_400: попытка передачи владения в приватном чате — отклоняется с 400 Bad Request (invalid_chat_type, CHAT-B006).
func TestHandler_TransferOwnership(t *testing.T) {
	h, mock := newTestHandler(t)

	tests := []struct {
		name         string
		userIDInBody string // что положить в {"userId": ...}
		setupMock    func()
		wantStatus   int
		wantCode     string
	}{
		{
			"Success",
			handlerTargetID,
			func() {
				mock.ExpectBegin()
				expectOwnerLock(mock, handlerActorID)
				expectTargetLock(mock)
				mock.ExpectExec(`UPDATE chats.chats SET owner_id = $1, updated_at = NOW() WHERE id = $2`).
					WithArgs(handlerTargetID, handlerChatID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(`UPDATE chats.members SET role = 'owner' WHERE chat_id = $1 AND user_id = $2`).
					WithArgs(handlerChatID, handlerTargetID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(`UPDATE chats.members SET role = 'member' WHERE chat_id = $1 AND user_id = $2`).
					WithArgs(handlerChatID, handlerActorID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			},
			http.StatusOK,
			"",
		},
		{
			"ActorNotOwner_409",
			handlerTargetID,
			func() {
				mock.ExpectBegin()
				expectOwnerLock(mock, handlerTargetID)
				mock.ExpectRollback()
			},
			http.StatusConflict,
			"ownership_conflict",
		},
		{
			"ChatNotFound_404",
			handlerTargetID,
			func() {
				mock.ExpectBegin()
				mock.ExpectQuery(ownerLockQuery).
					WithArgs(handlerChatID).
					WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
			},
			http.StatusNotFound,
			"chat_not_found",
		},
		{
			"TargetNotMember_400",
			handlerTargetID,
			func() {
				mock.ExpectBegin()
				expectOwnerLock(mock, handlerActorID)
				mock.ExpectQuery(memberRoleLockQuery).
					WithArgs(handlerChatID, handlerTargetID).
					WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
			},
			http.StatusBadRequest,
			"not_member",
		},
		{
			"SelfTransfer_400",
			handlerActorID, // цель = актор
			func() {},      // SQL-ожиданий нет — сервис отвергнет раньше
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
		{
			"PrivateChat_400",
			handlerTargetID,
			func() {
				mock.ExpectBegin()
				mock.ExpectQuery(ownerLockQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"owner_id", "type"}).AddRow(handlerActorID, "private"))
				mock.ExpectRollback()
			},
			http.StatusBadRequest,
			"invalid_chat_type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			body, _ := json.Marshal(map[string]string{"userId": tt.userIDInBody})
			req := newAuthedRequest(http.MethodPost, "/api/v2/chats/"+handlerChatID+"/transfer-ownership", body, handlerActorID)

			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}

// TestHandler_SendMessage_Errors проверяет маппинг ошибок SendMessage в HTTP:
// muted → 403 member_muted; не участник → 403 access_denied.
func TestHandler_SendMessage_Errors(t *testing.T) {
	h, mock := newTestHandler(t)

	tests := []struct {
		name       string
		setupMock  func()
		wantStatus int
		wantCode   string
	}{
		{
			"MemberMuted",
			func() {
				mock.ExpectQuery(sendMessageMuteQuery).
					WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", true))
			},
			http.StatusForbidden, // 403
			"member_muted",
		},
		{
			"NotMember",
			func() {
				mock.ExpectQuery(sendMessageMuteQuery).WillReturnError(sql.ErrNoRows)
			},
			http.StatusForbidden, // 403
			"access_denied",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			body, _ := json.Marshal(map[string]string{"content": "hello"})
			req := newAuthedRequest(http.MethodPost, "/api/v2/messages/"+handlerChatID, body, handlerTargetID)
			req.SetPathValue("chatId", handlerChatID)

			rr := httptest.NewRecorder()
			h.SendMessage(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}

// TestHandler_MuteMember_InvalidUUID проверяет, что невалидные UUID в пути
// mute отклоняются 400 validation_failed без обращения к БД (сервисная
// валидация + respondSuccess). Закрывает критерий «некорректные UUID не приводят к 500».
func TestHandler_MuteMember_InvalidUUID(t *testing.T) {
	h, mock := newTestHandler(t)
	req := newAuthedRequest(http.MethodPost, "/api/v2/chats/not-a-uuid/members/"+handlerTargetID+"/mute", nil, handlerActorID)
	rr := httptest.NewRecorder()
	h.Chat(rr, req)
	assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestHandler_MuteMember_Body проверяет разбор тела mute: валидный
// mutedUntil (RFC3339) передаётся в сервис, кривой таймстемп → 400 validation_failed без SQL.
func TestHandler_MuteMember_Body(t *testing.T) {
	future := time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)
	h, mock := newTestHandler(t)

	tests := []struct {
		name       string
		setupMock  func()
		body       string
		wantStatus int
		wantCode   string
	}{
		{
			"валидное тело",
			func() {
				mock.ExpectQuery(actorChatInfoQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))
				mock.ExpectQuery(muteMemberTargetQuery).
					WithArgs(handlerTargetID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow("member", nil, nil))
				mock.ExpectExec(muteMemberUpdateQuery).
					WithArgs(handlerChatID, handlerTargetID, future).
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			`{"mutedUntil": "2030-01-01T12:00:00Z"}`,
			http.StatusOK,
			"",
		},
		{
			"невалидное тело",
			nil,
			`{"mutedUntil": "not-a-timestamp"}`,
			http.StatusBadRequest, // 400
			"validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setupMock != nil {
				tt.setupMock()
			}

			req := newAuthedRequest(http.MethodPost, "/api/v2/chats/"+handlerChatID+"/members/"+handlerTargetID+"/mute", []byte(tt.body), handlerActorID)
			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestHandler_BanMember_Body проверяет разбор тела ban: валидные
// bannedUntil (RFC3339) и reason передаются в сервис, кривой таймстемп →
// 400 validation_failed без SQL. Раньше ошибка decode молча глоталась
// (_ = decode), а bannedUntil всегда был nil.
func TestHandler_BanMember_Body(t *testing.T) {
	future := time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)
	h, mock := newTestHandler(t)

	tests := []struct {
		name       string
		setupMock  func()
		body       string
		wantStatus int
		wantCode   string
	}{
		{
			"валидное тело",
			func() {
				mock.ExpectQuery(actorChatInfoQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))
				mock.ExpectQuery(userExistsQuery).
					WithArgs(muteTestUserID).
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				mock.ExpectBegin()
				mock.ExpectQuery(banMemberLockQuery).WithArgs(handlerChatID, handlerTargetID).WillReturnRows(sqlmock.NewRows([]string{"pg_advisory_xact_lock"}).AddRow(nil))
				mock.ExpectQuery(banTargetRoleQuery).
					WithArgs(handlerTargetID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
				mock.ExpectQuery(banSelectQuery).
					WithArgs(handlerChatID, handlerTargetID).
					WillReturnError(sql.ErrNoRows)
				mock.ExpectExec(`DELETE FROM chats.members WHERE chat_id = $1 AND user_id = $2`).
					WithArgs(handlerChatID, handlerTargetID).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(banUpsertQuery).
					WithArgs(handlerChatID, handlerTargetID, handlerActorID, "spam", future).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			`{"bannedUntil": "2030-01-01T12:00:00Z", "reason": "spam"}`,
			http.StatusOK,
			"",
		},
		{
			"невалидное тело",
			nil,
			`{"bannedUntil": "not-a-timestamp"}`,
			http.StatusBadRequest, // 400
			"validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setupMock != nil {
				tt.setupMock()
			}

			req := newAuthedRequest(http.MethodPost, "/api/v2/chats/"+handlerChatID+"/members/"+handlerTargetID+"/ban", []byte(tt.body), handlerActorID)
			rr := httptest.NewRecorder()
			h.Chat(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestHandler_ListBans_PrivateChatRejected проверяет HTTP-маппинг запрета
// moderation-операций в private chat: ErrInvalidChatType из Service.ListBans
// должен стать 400 invalid_chat_type, а не общим 500 internal_error.
func TestHandler_ListBans_PrivateChatRejected(t *testing.T) {
	h, mock := newTestHandler(t)

	mock.ExpectQuery(actorChatInfoQuery).
		WithArgs(handlerActorID, handlerChatID).
		WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("private", "member"))

	req := newAuthedRequest(http.MethodGet, "/api/v2/chats/"+handlerChatID+"/bans", nil, handlerActorID)
	rr := httptest.NewRecorder()
	h.Chat(rr, req)

	assertErrorResponse(t, rr, http.StatusBadRequest, "invalid_chat_type")
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestHandler_GetOnlineMembers проверяет маппинг ошибок GetOnlineMembers
// в HTTP-статусы и JSON-коды: по одному кейсу на каждый sentinel сервиса.
func TestHandler_GetOnlineMembers(t *testing.T) {
	onlineStore := presence.NewMemoryStore(time.Now)
	if err := onlineStore.Connect(context.Background(), handlerActorID, handlerTargetID); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name        string
		chatID      string
		store       presence.Store
		setupMock   func(sqlmock.Sqlmock)
		wantStatus  int
		wantCode    string
		wantMembers []string
	}{
		{
			name:       "InvalidInput",
			chatID:     "not-a-uuid",
			setupMock:  func(sqlmock.Sqlmock) {},
			wantStatus: http.StatusBadRequest,
			wantCode:   "validation_failed",
		},
		{
			name:   "ChatNotFound",
			chatID: handlerChatID,
			setupMock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(onlineTypeQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"type"}))
			},
			wantStatus: http.StatusNotFound,
			wantCode:   "chat_not_found",
		},
		{
			name:   "NotMember",
			chatID: handlerChatID,
			setupMock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(onlineTypeQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
				m.ExpectQuery(memberRoleQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}))
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "access_denied",
		},
		{
			name:   "InvalidChatType",
			chatID: handlerChatID,
			setupMock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(onlineTypeQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("private"))
				m.ExpectQuery(memberRoleQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_chat_type",
		},
		{
			name:   "OK",
			chatID: handlerChatID,
			store:  onlineStore,
			setupMock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(onlineTypeQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
				m.ExpectQuery(memberRoleQuery).
					WithArgs(handlerActorID, handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
				m.ExpectQuery(onlineMemberIDsQuery).
					WithArgs(handlerChatID).
					WillReturnRows(sqlmock.NewRows([]string{"user_id"}).
						AddRow(handlerActorID).AddRow(handlerTargetID))
			},
			wantStatus:  http.StatusOK,
			wantMembers: []string{handlerActorID},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })

			tt.setupMock(mock)

			h := NewHandler(NewService(db, nil, tt.store))
			req := newAuthedRequest(http.MethodGet, "/api/v2/chats/"+tt.chatID+"/members-online", nil, handlerActorID)
			req.SetPathValue("chatID", tt.chatID)

			rr := httptest.NewRecorder()
			h.GetOnlineMembers(rr, req)

			assertErrorResponse(t, rr, tt.wantStatus, tt.wantCode)
			if tt.wantMembers != nil {
				var body struct {
					Members []string `json:"members"`
				}
				require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
				require.Equal(t, tt.wantMembers, body.Members)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// newTestHandlerQueryMatcher builds a Handler backed by a fresh sqlmock instance and
// registers cleanup for the underlying DB. Creating the mock per subtest
// keeps test cases independent: a failure in one case cannot leak
// expectations into the next.
func newTestHandlerQueryMatcher(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	return NewHandler(NewService(db, nil, nil)), mock
}

func TestHandler_List(t *testing.T) {
	const userID = "550e8400-e29b-41d4-a716-446655440000"

	// Column set returned by scanChats. Must match the SELECT list
	// exactly; otherwise sqlmock fails with a column-count mismatch.
	cols := []string{
		"id", "type", "title", "description", "avatar_url", "owner_id", "role",
		"is_pinned", "is_archived", "last_read_at", "created_at", "updated_at",
		"member_count", "last_message_at", "peer_id", "peer_is_online", "peer_last_seen",
		"unread_count", "lm_id", "lm_sender_id", "lm_content", "lm_type", "lm_sender",
		"peer_privacy", "peer_blocks_viewer",
	}

	tests := []struct {
		name          string
		method        string
		rawQuery      string // raw query string, without leading "?"
		setupMock     func(mock sqlmock.Sqlmock)
		wantStatus    int
		wantErrorCode string
	}{
		// --- positive ---
		{
			name:     "no_archived_defaults_to_false",
			method:   http.MethodGet,
			rawQuery: "",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT .+ FROM chats\.chats c .+`).
					WithArgs(userID, false).
					WillReturnRows(sqlmock.NewRows(cols))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:     "archived_true",
			method:   http.MethodGet,
			rawQuery: "archived=true",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT .+ FROM chats\.chats c .+`).
					WithArgs(userID, true).
					WillReturnRows(sqlmock.NewRows(cols))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:     "archived_false",
			method:   http.MethodGet,
			rawQuery: "archived=false",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT .+ FROM chats\.chats c .+`).
					WithArgs(userID, false).
					WillReturnRows(sqlmock.NewRows(cols))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:     "other_params_ignored",
			method:   http.MethodGet,
			rawQuery: "limit=10&archived=true",
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT .+ FROM chats\.chats c .+`).
					WithArgs(userID, true).
					WillReturnRows(sqlmock.NewRows(cols))
			},
			wantStatus: http.StatusOK,
		},

		// --- negative: invalid literals ---
		{
			name:          "invalid_not_a_bool",
			method:        http.MethodGet,
			rawQuery:      "archived=not-a-bool",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "invalid_yes",
			method:        http.MethodGet,
			rawQuery:      "archived=yes",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "invalid_on",
			method:        http.MethodGet,
			rawQuery:      "archived=on",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "invalid_number_two",
			method:        http.MethodGet,
			rawQuery:      "archived=2",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "invalid_trailing_space",
			method:        http.MethodGet,
			rawQuery:      "archived=true%20",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},

		// --- negative: strictness of the literals ---
		{
			name:          "strict_rejects_uppercase_true",
			method:        http.MethodGet,
			rawQuery:      "archived=TRUE",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "strict_rejects_capitalized_true",
			method:        http.MethodGet,
			rawQuery:      "archived=True",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "strict_rejects_numeric_one",
			method:        http.MethodGet,
			rawQuery:      "archived=1",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "strict_rejects_single_t",
			method:        http.MethodGet,
			rawQuery:      "archived=t",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},

		// --- negative: shape ---
		{
			name:          "empty_value_rejected",
			method:        http.MethodGet,
			rawQuery:      "archived=",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "duplicated_conflicting",
			method:        http.MethodGet,
			rawQuery:      "archived=true&archived=false",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:          "duplicated_same",
			method:        http.MethodGet,
			rawQuery:      "archived=true&archived=true",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},

		// --- method ---
		{
			name:          "method_not_allowed",
			method:        http.MethodPost,
			rawQuery:      "",
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusMethodNotAllowed,
			wantErrorCode: "method_not_allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mock := newTestHandlerQueryMatcher(t)
			tt.setupMock(mock)

			path := "/api/v2/chats"
			if tt.rawQuery != "" {
				path += "?" + tt.rawQuery
			}
			req := httptest.NewRequest(tt.method, path, nil)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")

			ctx := authctx.WithUser(req.Context(), authctx.User{ID: userID, Username: "testuser"})
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			h.List(rr, req)

			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body: %s", rr.Code, tt.wantStatus, rr.Body.String())
			}

			if tt.wantErrorCode != "" {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatalf("response is not valid JSON: %v, body: %s", err, rr.Body.String())
				}
				if got, _ := resp["code"].(string); got != tt.wantErrorCode {
					t.Errorf("error code = %v, want %q", resp["code"], tt.wantErrorCode)
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("mock expectations not met: %v", err)
			}
		})
	}
}

func TestParseArchived(t *testing.T) {
	tests := []struct {
		name    string
		query   string
		want    bool
		wantErr bool
	}{
		{"absent", "", false, false},
		{"true", "archived=true", true, false},
		{"false", "archived=false", false, false},

		{"empty", "archived=", false, true},
		{"uppercase TRUE", "archived=TRUE", false, true},
		{"capitalized True", "archived=True", false, true},
		{"numeric one", "archived=1", false, true},
		{"single t", "archived=t", false, true},
		{"yes", "archived=yes", false, true},
		{"trailing space", "archived=true%20", false, true},
		{"duplicated conflicting", "archived=true&archived=false", false, true},
		{"duplicated same", "archived=true&archived=true", false, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q, err := url.ParseQuery(tt.query)
			if err != nil {
				t.Fatalf("bad test query %q: %v", tt.query, err)
			}

			got, err := parseArchived(q)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("got %v, want %v", got, tt.want)
			}

		})
	}
}

// TestHandler_CreateGroup covers CreateGroup: successful creation,
// field trimming, validation failures (title too long, empty title,
// empty members), service errors, and method rejection.
func TestHandler_CreateGroup(t *testing.T) {
	const (
		actorID   = "550e8400-e29b-41d4-a716-446655440001"
		memberID1 = "550e8400-e29b-41d4-a716-446655440002"
		memberID2 = "550e8400-e29b-41d4-a716-446655440003"
	)

	tests := []struct {
		name          string
		method        string
		requestBody   map[string]any
		setupMock     func(mock sqlmock.Sqlmock)
		wantStatus    int
		wantErrorCode string
		wantChatID    bool
		wantTitle     string
	}{
		{
			name:   "success_valid_input",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":       "My Group",
				"description": "A test group",
				"avatarUrl":   "https://example.com/avatar.png",
				"members":     []string{memberID1, memberID2},
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(`INSERT INTO chats\.chats`).
					WithArgs("My Group", "A test group", "https://example.com/avatar.png", actorID).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("chat-123"))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", actorID, "owner").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", memberID1, "member").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", memberID2, "member").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusCreated,
			wantChatID: true,
			wantTitle:  "My Group",
		},
		{
			name:   "success_trims_fields",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":       "  My Group  ",
				"description": "  desc  ",
				"avatarUrl":   "  https://example.com/a.png  ",
				"members":     []string{memberID1},
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(`INSERT INTO chats\.chats`).
					WithArgs("My Group", "desc", "https://example.com/a.png", actorID).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("chat-123"))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", actorID, "owner").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", memberID1, "member").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusCreated,
			wantChatID: true,
			wantTitle:  "My Group",
		},
		{
			name:   "title_at_limit_after_trim",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   "  " + strings.Repeat("a", 128) + "  ",
				"members": []string{memberID1},
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(`INSERT INTO chats\.chats`).
					WithArgs(strings.Repeat("a", 128), "", "", actorID).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("chat-123"))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", actorID, "owner").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("chat-123", memberID1, "member").
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			wantStatus: http.StatusCreated,
			wantChatID: true,
			wantTitle:  strings.Repeat("a", 128),
		},
		{
			name:   "title_too_long_400",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   strings.Repeat("a", 129),
				"members": []string{memberID1},
			},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:   "empty_title_400",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   "   ",
				"members": []string{memberID1},
			},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:   "empty_members_400",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   "Group",
				"members": []string{},
			},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:   "misspelled_title_is_missing_400",
			method: http.MethodPost,
			requestBody: map[string]any{
				"titel":   "Group",
				"members": []string{memberID1},
			},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:   "service_error_500",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   "Group",
				"members": []string{memberID1},
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(`INSERT INTO chats\.chats`).
					WillReturnError(sql.ErrConnDone)
				mock.ExpectRollback()
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "internal_error",
		},
		{
			name:          "method_not_allowed_405",
			method:        http.MethodPatch,
			requestBody:   nil,
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusMethodNotAllowed,
			wantErrorCode: "method_not_allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mock := newTestHandlerQueryMatcher(t)
			tt.setupMock(mock)

			var bodyBytes []byte
			if tt.requestBody != nil {
				var err error
				bodyBytes, err = json.Marshal(tt.requestBody)
				if err != nil {
					t.Fatal(err)
				}
			}

			req := httptest.NewRequest(tt.method, "/api/v2/chats/groups", bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")

			ctx := authctx.WithUser(req.Context(), authctx.User{ID: actorID, Username: "testuser"})
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			h.CreateGroup(rr, req)

			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body: %s", rr.Code, tt.wantStatus, rr.Body.String())
			}

			if tt.wantErrorCode != "" {
				assertErrorCode(t, rr, tt.wantErrorCode)
			}

			if tt.wantChatID {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatalf("invalid JSON: %v, body: %s", err, rr.Body.String())
				}
				if _, ok := resp["chatId"]; !ok {
					t.Errorf("expected chatId in response, got %v", resp)
				}
				if got, _ := resp["title"].(string); got != tt.wantTitle {
					t.Errorf("title = %q, want %q", got, tt.wantTitle)
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("mock expectations not met: %v", err)
			}
		})
	}
}

// TestHandler_UpdateGroup covers UpdateGroup: successful updates (full
// and partial), field trimming, validation failures, strict JSON decoding
// (unknown fields and trailing data), domain errors (not found, forbidden,
// invalid chat type, DB failure), and method rejection.
func TestHandler_UpdateGroup(t *testing.T) {
	const (
		actorID = "550e8400-e29b-41d4-a716-446655440001"
		chatID  = "550e8400-e29b-41d4-a716-446655440002"
	)

	// Column set returned by service.Get; must match its SELECT list
	// or sqlmock fails with a column-count mismatch.
	chatCols := []string{
		"id", "type", "title", "description", "avatar_url", "owner_id", "role",
		"is_pinned", "is_archived", "last_read_at", "created_at", "updated_at",
		"member_count", "last_message_at", "peer_id", "peer_is_online", "peer_last_seen",
		"unread_count", "lm_id", "lm_sender_id", "lm_content", "lm_type", "lm_sender",
		"peer_privacy", "peer_blocks_viewer",
	}

	newChatRow := func(title, description, avatarURL string) *sqlmock.Rows {
		return sqlmock.NewRows(chatCols).AddRow(
			chatID, "group", title, description, avatarURL, actorID, "owner",
			false, false, "", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z",
			3, "", "", false, "", 0, "", "", "", "", "", nil, false,
		)
	}

	tests := []struct {
		name        string
		method      string
		path        string
		requestBody map[string]any
		// rawBody is used when the request body cannot be produced via
		// json.Marshal, e.g. malformed payloads or bodies with trailing
		// data. When set, it takes precedence over requestBody.
		rawBody       []byte
		setupMock     func(mock sqlmock.Sqlmock)
		wantStatus    int
		wantErrorCode string
	}{
		{
			name:   "success_update_all_fields",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title":       "Updated Group",
				"description": "New description",
				"avatarUrl":   "https://example.com/new-avatar.png",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE`).
					WithArgs("Updated Group", "New description", "https://example.com/new-avatar.png", chatID).
					WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(`SELECT c\.id::text, c\.type, .+ FROM chats\.chats c`).
					WithArgs(actorID, chatID).
					WillReturnRows(newChatRow("Updated Group", "New description", "https://example.com/new-avatar.png"))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:   "success_update_only_title",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title": "New Title Only",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "admin"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE`).
					WithArgs("New Title Only", nil, nil, chatID).
					WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(`SELECT c\.id::text, c\.type, .+ FROM chats\.chats c`).
					WithArgs(actorID, chatID).
					WillReturnRows(newChatRow("New Title Only", "Old description", ""))
			},
			wantStatus: http.StatusOK,
		},
		{
			// Verifies trimming for all three fields before the UPDATE.
			name:   "success_trims_fields",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title":       "  Trimmed  ",
				"description": "  desc  ",
				"avatarUrl":   "  https://example.com/a.png  ",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE`).
					WithArgs("Trimmed", "desc", "https://example.com/a.png", chatID).
					WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(`SELECT c\.id::text, c\.type, .+ FROM chats\.chats c`).
					WithArgs(actorID, chatID).
					WillReturnRows(newChatRow("Trimmed", "desc", "https://example.com/a.png"))
			},
			wantStatus: http.StatusOK,
		},
		{
			// 128 runes with surrounding whitespace must pass after trim.
			name:   "title_at_limit_after_trim",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title": "  " + strings.Repeat("a", 128) + "  ",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE`).
					WithArgs(strings.Repeat("a", 128), nil, nil, chatID).
					WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(`SELECT c\.id::text, c\.type, .+ FROM chats\.chats c`).
					WithArgs(actorID, chatID).
					WillReturnRows(newChatRow(strings.Repeat("a", 128), "", ""))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:   "title_too_long_400",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title": strings.Repeat("a", 129),
			},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			// Handler rejects an empty body before calling the service.
			name:          "empty_body_all_nil_400",
			method:        http.MethodPatch,
			path:          "/api/v2/chats/" + chatID,
			requestBody:   map[string]any{},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			// Guards decodeStrict's DisallowUnknownFields in the PATCH path.
			// A valid title is present so the request fails specifically
			// because of the unknown field, not because of a missing value.
			// The service must never be called.
			name:   "unknown_field_patch_400",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title":        "New Title",
				"unknownField": "x",
			},
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "invalid_json",
		},
		{
			// Guards decodeStrict's trailing-data check in the PATCH path.
			// The first JSON object is valid; the second one is extra data
			// and must be rejected. The service must never be called.
			name:          "trailing_second_json_object_patch_400",
			method:        http.MethodPatch,
			path:          "/api/v2/chats/" + chatID,
			rawBody:       []byte(`{"title":"New Title"}{"title":"Second"}`),
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "invalid_json",
		},
		{
			name:   "chat_not_found_404",
			method: http.MethodPatch,
			path:   "/api/v2/chats/non-existent-id",
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs("non-existent-id", actorID).
					WillReturnError(sql.ErrNoRows)
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "chat_not_found",
		},
		{
			name:   "forbidden_member_role_403",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "member"))
			},
			wantStatus:    http.StatusForbidden,
			wantErrorCode: "access_denied",
		},
		{
			name:   "not_a_group_400",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("private", "owner"))
			},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "invalid_chat_type",
		},
		{
			name:   "database_error_500",
			method: http.MethodPatch,
			path:   "/api/v2/chats/" + chatID,
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE`).
					WithArgs("New Title", nil, nil, chatID).
					WillReturnError(sql.ErrConnDone)
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "internal_error",
		},
		{
			name:          "method_not_allowed_405",
			method:        http.MethodPost,
			path:          "/api/v2/chats/" + chatID,
			requestBody:   nil,
			setupMock:     func(sqlmock.Sqlmock) {},
			wantStatus:    http.StatusMethodNotAllowed,
			wantErrorCode: "method_not_allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mock := newTestHandlerQueryMatcher(t)
			tt.setupMock(mock)

			var bodyBytes []byte
			switch {
			case tt.rawBody != nil:
				bodyBytes = tt.rawBody
			case tt.requestBody != nil:
				var err error
				bodyBytes, err = json.Marshal(tt.requestBody)
				if err != nil {
					t.Fatal(err)
				}
			}

			req := httptest.NewRequest(tt.method, tt.path, bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")

			ctx := authctx.WithUser(req.Context(), authctx.User{ID: actorID, Username: "testuser"})
			req = req.WithContext(ctx)

			// PathValue requires the request to pass through a ServeMux.
			// The pattern has no method prefix so the handler's own method
			// check still runs (needed for method_not_allowed_405).
			mux := http.NewServeMux()
			mux.HandleFunc("/api/v2/chats/{chatID}", h.UpdateGroup)

			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)

			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body: %s", rr.Code, tt.wantStatus, rr.Body.String())
			}

			if tt.wantErrorCode != "" {
				assertErrorCode(t, rr, tt.wantErrorCode)
			}

			if rr.Code == http.StatusOK {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatalf("invalid JSON: %v, body: %s", err, rr.Body.String())
				}
				if _, ok := resp["chat"]; !ok {
					t.Errorf("expected 'chat' field in response, got %v", resp)
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("mock expectations not met: %v", err)
			}
		})
	}
}

// assertErrorCode fails the test if the response body does not contain
// the expected "code" field.
func assertErrorCode(t *testing.T, rr *httptest.ResponseRecorder, want string) {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v, body: %s", err, rr.Body.String())
	}
	if got, _ := resp["code"].(string); got != want {
		t.Errorf("error code = %q, want %q", got, want)
	}
}
