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

// TestHandler_CreateGroup tests the CreateGroup handler method.
// It covers:
//   - successful group creation with valid input
//   - validation errors (title too long, empty title, empty members)
//   - service errors (database failure)
//   - HTTP method not allowed
//
// The test uses sqlmock with regexp matcher to verify database interactions
// and the handler's error mapping logic.
// TestHandler_CreateGroup tests the CreateGroup handler method.
func TestHandler_CreateGroup(t *testing.T) {
	// Fixed user IDs used across test cases.
	actorID := "c923612a-bcac-455f-8f9b-5243687537c3"
	memberID1 := "550e8400-e29b-41d4-a716-446655440002"
	memberID2 := "550e8400-e29b-41d4-a716-446655440003"

	tests := []struct {
		name          string
		method        string
		requestBody   map[string]any
		setupMock     func(*sqlmock.Sqlmock)
		wantStatus    int
		wantErrorCode string
		wantChatID    bool
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
			setupMock: func(mock *sqlmock.Sqlmock) {
				// Expect a transaction to be started.
				(*mock).ExpectBegin()

				// Insert the chat and return an ID.
				(*mock).ExpectQuery(`INSERT INTO chats\.chats`).
					WithArgs("My Group", "A test group", "https://example.com/avatar.png", actorID).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("bffb425d-8903-40ef-b864-30250f882375"))

				// Insert the owner as a member.
				(*mock).ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("bffb425d-8903-40ef-b864-30250f882375", actorID).
					WillReturnResult(sqlmock.NewResult(1, 1))

				// Insert member1 with SELECT subquery.
				(*mock).ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("bffb425d-8903-40ef-b864-30250f882375", memberID1).
					WillReturnResult(sqlmock.NewResult(1, 1))

				// Insert member2 with SELECT subquery.
				(*mock).ExpectExec(`INSERT INTO chats\.members`).
					WithArgs("bffb425d-8903-40ef-b864-30250f882375", memberID2).
					WillReturnResult(sqlmock.NewResult(1, 1))

				// Expect commit.
				(*mock).ExpectCommit()
			},
			wantStatus: http.StatusCreated,
			wantChatID: true,
		},
		{
			name:   "title_too_long_400",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   string(make([]byte, 129)), // 129 characters
				"members": []string{memberID1},
			},
			setupMock: func(mock *sqlmock.Sqlmock) {
				// No database calls should be made because validation fails
				// before reaching the service.
			},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:   "empty_title_400",
			method: http.MethodPost,
			requestBody: map[string]any{
				"title":   "",
				"members": []string{memberID1},
			},
			setupMock: func(mock *sqlmock.Sqlmock) {
				// Service will return ErrInvalidInput
				// No DB expectations needed
			},
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
			setupMock: func(mock *sqlmock.Sqlmock) {
				// Service returns ErrInvalidInput before any DB operations.
			},
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
			setupMock: func(mock *sqlmock.Sqlmock) {
				// Simulate a database error during chat insertion.
				(*mock).ExpectBegin()
				(*mock).ExpectQuery(`INSERT INTO chats\.chats`).
					WillReturnError(sql.ErrConnDone)
				(*mock).ExpectRollback()
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "internal_error",
		},
		{
			name:          "method_not_allowed_405",
			method:        http.MethodPatch,
			requestBody:   nil,
			setupMock:     func(mock *sqlmock.Sqlmock) {},
			wantStatus:    http.StatusMethodNotAllowed,
			wantErrorCode: "method_not_allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Создаем новый мок для каждого тестового случая
			db, mock, err := sqlmock.New(
				sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp),
			)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			// Instantiate the service with the mock DB
			svc := NewService(db, nil)
			h := NewHandler(svc)

			// Set up the mock expectations для этого теста
			tt.setupMock(&mock)

			// Build the request body as JSON.
			var bodyBytes []byte
			if tt.requestBody != nil {
				bodyBytes, err = json.Marshal(tt.requestBody)
				if err != nil {
					t.Fatal(err)
				}
			}
			req := httptest.NewRequest(tt.method, "/api/v2/chats/groups", bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")

			user := authctx.User{ID: actorID, Username: "testuser"}

			ctx := authctx.WithUser(req.Context(), user)
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			h.CreateGroup(rr, req)

			// Validate status code.
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body: %s", rr.Code, tt.wantStatus, rr.Body.String())
			}

			// For error cases, check the error code in the JSON response.
			if tt.wantErrorCode != "" {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatal(err)
				}
				if got, ok := resp["code"].(string); !ok || got != tt.wantErrorCode {
					t.Errorf("error code = %v, want %q", resp["code"], tt.wantErrorCode)
				}
			}

			// For success case, verify that chatId is present.
			if tt.wantChatID {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatal(err)
				}
				if _, ok := resp["chatId"]; !ok {
					t.Errorf("expected chatId in response, got %v", resp)
				}
				if _, ok := resp["title"]; !ok {
					t.Errorf("expected title in response, got %v", resp)
				}
			}

			// Verify that all mock expectations were met.
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("mock expectations not met: %v", err)
			}
		})
	}
}

// TestHandler_UpdateGroup tests the UpdateGroup handler method.
// It covers:
//   - successful updates with all fields or partial fields
//   - validation errors (title too long, empty body)
//   - service errors (not found, forbidden, invalid chat type, database failure)
//   - HTTP method not allowed
//
// The test uses sqlmock with regexp matcher to verify database interactions.
func TestHandler_UpdateGroup(t *testing.T) {
	// Setup mock database with regexp query matcher.
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Create service and handler with the mock DB.
	svc := NewService(db, nil)
	h := NewHandler(svc)

	// Fixed IDs for testing.
	actorID := "c923612a-bcac-455f-8f9b-5243687537c3"
	chatID := "bffb425d-8903-40ef-b864-30250f882375"

	// Columns returned by scanChats (used by service.Get after update).
	chatCols := []string{
		"id", "type", "title", "description", "avatar_url", "owner_id", "role",
		"is_pinned", "is_archived", "last_read_at", "created_at", "updated_at",
		"member_count", "last_message_at", "peer_id", "peer_is_online", "peer_last_seen",
		"unread_count", "lm_id", "lm_sender_id", "lm_content", "lm_type", "lm_sender",
	}

	tests := []struct {
		name          string
		method        string
		chatID        string // path parameter
		requestBody   map[string]any
		setupMock     func()
		wantStatus    int
		wantErrorCode string
	}{
		{
			name:   "success_update_all_fields",
			method: http.MethodPatch,
			chatID: chatID,
			requestBody: map[string]any{
				"title":       "Updated Group",
				"description": "New description",
				"avatarUrl":   "https://example.com/new-avatar.png",
			},
			setupMock: func() {
				// 1. SELECT c.type, m.role for permission check.
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))

				// 2. UPDATE chats.chats.
				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE\(\$1::text, title\), description = COALESCE\(\$2::text, description\), avatar_url = COALESCE\(\$3::text, avatar_url\), updated_at = NOW\(\) WHERE id = \$4 AND type = 'group'`).
					WithArgs("Updated Group", "New description", "https://example.com/new-avatar.png", chatID).
					WillReturnResult(sqlmock.NewResult(0, 1))

				// 3. service.Get – fetches the updated chat.
				mock.ExpectQuery(`SELECT c\.id::text, c\.type, .+ FROM chats\.chats c`).
					WithArgs(actorID, chatID).
					WillReturnRows(sqlmock.NewRows(chatCols).AddRow(
						chatID, "group", "Updated Group", "New description",
						"https://example.com/new-avatar.png", actorID, "owner",
						false, false, "", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z",
						3, "", "", false, "", 0, "", "", "", "", "",
					))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:   "success_update_only_title",
			method: http.MethodPatch,
			chatID: chatID,
			requestBody: map[string]any{
				"title": "New Title Only",
			},
			setupMock: func() {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "admin"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE\(\$1::text, title\), description = COALESCE\(\$2::text, description\), avatar_url = COALESCE\(\$3::text, avatar_url\), updated_at = NOW\(\) WHERE id = \$4 AND type = 'group'`).
					WithArgs("New Title Only", nil, nil, chatID).
					WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(`SELECT c\.id::text, c\.type, .+ FROM chats\.chats c`).
					WithArgs(actorID, chatID).
					WillReturnRows(sqlmock.NewRows(chatCols).AddRow(
						chatID, "group", "New Title Only", "Old description",
						"", actorID, "admin",
						false, false, "", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z",
						3, "", "", false, "", 0, "", "", "", "", "",
					))
			},
			wantStatus: http.StatusOK,
		},
		{
			name:   "title_too_long_400",
			method: http.MethodPatch,
			chatID: chatID,
			requestBody: map[string]any{
				"title": string(make([]byte, 129)), // 129 characters
			},
			setupMock: func() {
				// No database calls – validation fails before service.
			},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:        "empty_body_all_nil_400",
			method:      http.MethodPatch,
			chatID:      chatID,
			requestBody: map[string]any{}, // empty JSON -> all fields nil
			setupMock: func() {
				// Service returns ErrInvalidInput, so we expect no DB calls.
				// (The handler calls the service, which will return error without queries.)
			},
			wantStatus:    http.StatusBadRequest,
			wantErrorCode: "validation_failed",
		},
		{
			name:   "chat_not_found_404",
			method: http.MethodPatch,
			chatID: "non-existent-id",
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func() {
				// First query returns no rows -> ErrNotFound.
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
			chatID: chatID,
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func() {
				// User is a member, not owner/admin.
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "member"))
				// No update attempt because service returns ErrForbidden.
			},
			wantStatus:    http.StatusForbidden,
			wantErrorCode: "access_denied",
		},
		{
			name:   "not_a_group_400",
			method: http.MethodPatch,
			chatID: chatID,
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func() {
				// Chat type is 'private', not 'group'.
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
			chatID: chatID,
			requestBody: map[string]any{
				"title": "New Title",
			},
			setupMock: func() {
				mock.ExpectQuery(`SELECT c\.type, m\.role FROM chats\.chats c JOIN chats\.members m`).
					WithArgs(chatID, actorID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow("group", "owner"))

				mock.ExpectExec(`UPDATE chats\.chats SET title = COALESCE\(\$1::text, title\)`).
					WithArgs("New Title", nil, nil, chatID).
					WillReturnError(sql.ErrConnDone)
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "internal_error",
		},
		{
			name:          "method_not_allowed_405",
			method:        http.MethodPost, // Not PATCH
			chatID:        chatID,
			requestBody:   nil,
			setupMock:     func() {},
			wantStatus:    http.StatusMethodNotAllowed,
			wantErrorCode: "method_not_allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			// Build request.
			var bodyBytes []byte
			if tt.requestBody != nil {
				bodyBytes, err = json.Marshal(tt.requestBody)
				if err != nil {
					t.Fatal(err)
				}
			}
			req := httptest.NewRequest(tt.method, "/api/v2/chats/"+tt.chatID, bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")

			// Set up route parameter
			req.SetPathValue("chatID", tt.chatID)

			user := authctx.User{ID: actorID, Username: "testuser"}
			ctx := authctx.WithUser(req.Context(), user)
			req = req.WithContext(ctx)

			// Execute request.
			rr := httptest.NewRecorder()
			h.UpdateGroup(rr, req)

			// Assert status code.
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body: %s", rr.Code, tt.wantStatus, rr.Body.String())
			}

			// For error cases, check error code.
			if tt.wantErrorCode != "" {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatal(err)
				}
				if got, ok := resp["code"].(string); !ok || got != tt.wantErrorCode {
					t.Errorf("error code = %v, want %q", resp["code"], tt.wantErrorCode)
				}
			}

			// For success cases, verify chat object is returned.
			if tt.wantStatus == http.StatusOK {
				var resp map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
					t.Fatal(err)
				}
				if _, ok := resp["chat"]; !ok {
					t.Errorf("expected 'chat' field in response, got %v", resp)
				}
			}

			// Check mock expectations.
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("mock expectations not met: %v", err)
			}
		})
	}
}
