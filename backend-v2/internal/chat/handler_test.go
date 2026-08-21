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
	ownerLockQuery        = `SELECT owner_id FROM chats.chats WHERE id = $1 FOR UPDATE`
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
	banSelectQuery = `SELECT banned_until, reason FROM chats.bans WHERE chat_id = $1 AND user_id = $2`
	banInsertQuery = `INSERT INTO chats.bans (chat_id, user_id, banned_by, reason, banned_until) VALUES ($1, $2, $3, $4, $5)`
)

// newTestHandler собирает Handler на sqlmock с точным совпадением SQL.
func newTestHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewHandler(NewService(db, nil)), mock
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
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(ownerID))
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

	svc := NewService(db, nil)
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
				mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectExec(`INSERT INTO chats\.members`).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectQuery(`SELECT .* FROM auth\.users`).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "first_name", "last_name", "avatar_url", "role", "permissions", "muted_until", "muted_at", "joined_at"}).AddRow(handlerTargetID, "u", "A", "B", "", "member", "{}", "", time.Now().Format(time.RFC3339), time.Now().Format(time.RFC3339)))
			},
			http.StatusCreated, // 201
			"",
		},
		{
			"AlreadyMember",
			func() {
				expectAddMemberPrechecks(mock)
				mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WillReturnRows(sqlmock.NewRows([]string{"?"}).AddRow(true))
			},
			http.StatusConflict, // 409
			"already_member",
		},
		{
			"UserBanned",
			func() {
				expectAddMemberPrechecks(mock)
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

			rr := httptest.NewRecorder()
			h.Messages(rr, req)

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
