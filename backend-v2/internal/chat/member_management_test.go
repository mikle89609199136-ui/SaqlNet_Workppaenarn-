package chat

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

type recordedBroadcast struct {
	chatID  string
	payload []byte
	exclude string
}

type recordingRealtime struct {
	broadcasts []recordedBroadcast
}

func (*recordingRealtime) CallRooms() *CallRoomManager { return nil }
func (*recordingRealtime) IsUserConnected(string) bool { return false }
func (r *recordingRealtime) BroadcastToChat(chatID string, payload []byte, exclude string) {
	r.broadcasts = append(r.broadcasts, recordedBroadcast{chatID: chatID, payload: payload, exclude: exclude})
}
func (r *recordingRealtime) BroadcastToUsers(
	userIDs []string,
	payload []byte,
) {
	for _, userID := range userIDs {
		r.broadcasts = append(r.broadcasts, recordedBroadcast{
			chatID:  userID,
			payload: payload,
		})
	}
}

const (
	testActorID     = "actor-id"
	testChatID      = "chat-id"
	testMemberID    = "member-id"
	muteTestActorID = "550e8400-e29b-41d4-a716-446655440001"
	muteTestChatID  = "550e8400-e29b-41d4-a716-446655440002"
	muteTestUserID  = "550e8400-e29b-41d4-a716-446655440003"
)

func expectActorInfo(mock sqlmock.Sqlmock, chatType, role string) {
	mock.ExpectQuery(`SELECT c\.type, cm\.role`).
		WithArgs(testActorID, testChatID).
		WillReturnRows(sqlmock.NewRows([]string{"type", "role"}).AddRow(chatType, role))
}

func expectTargetRole(mock sqlmock.Sqlmock, role string) {
	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(testChatID, testMemberID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
}

func newMemberManagementService(t *testing.T) (*Service, sqlmock.Sqlmock, *recordingRealtime) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	realtime := &recordingRealtime{}
	return NewService(db, realtime), mock, realtime
}

func TestSetMemberRole_OwnerUpdatesMemberAndBroadcasts(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	expectTargetRole(mock, "member")
	mock.ExpectExec(`UPDATE chats\.members SET role`).
		WithArgs("admin", testChatID, testMemberID, "member").
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "admin"); err != nil {
		t.Fatalf("SetMemberRole() error = %v", err)
	}
	if len(realtime.broadcasts) != 1 {
		t.Fatalf("broadcast count = %d, want 1", len(realtime.broadcasts))
	}
	var event MemberRoleUpdatedEvent
	if err := json.Unmarshal(realtime.broadcasts[0].payload, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "chat_member_role_updated" || event.ChatID != testChatID || event.UserID != testMemberID || event.Role != "admin" {
		t.Fatalf("unexpected event: %+v", event)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSetMemberRole_SameRoleIsIdempotentWithoutBroadcast(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	expectTargetRole(mock, "admin")

	if err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "admin"); err != nil {
		t.Fatalf("SetMemberRole() error = %v", err)
	}
	if len(realtime.broadcasts) != 0 {
		t.Fatalf("broadcast count = %d, want 0", len(realtime.broadcasts))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSetMemberRole_RejectsForbiddenCases(t *testing.T) {
	t.Run("self", func(t *testing.T) {
		svc, mock, realtime := newMemberManagementService(t)
		err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testActorID, "admin")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("error = %v, want ErrForbidden", err)
		}
		if len(realtime.broadcasts) != 0 {
			t.Fatal("unexpected broadcast")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	for _, actorRole := range []string{"admin", "member"} {
		t.Run(actorRole+" actor", func(t *testing.T) {
			svc, mock, _ := newMemberManagementService(t)
			expectActorInfo(mock, "group", actorRole)
			err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "admin")
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("error = %v, want ErrForbidden", err)
			}
		})
	}

	t.Run("owner target", func(t *testing.T) {
		svc, mock, _ := newMemberManagementService(t)
		expectActorInfo(mock, "group", "owner")
		expectTargetRole(mock, "owner")
		err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "member")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("error = %v, want ErrForbidden", err)
		}
	})
}

func TestSetMemberRole_MemberNotFound(t *testing.T) {
	svc, mock, _ := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(testChatID, testMemberID).
		WillReturnError(sql.ErrNoRows)

	err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "admin")
	if !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("error = %v, want ErrMemberNotFound", err)
	}
}

func TestSetMemberRole_NoRowsAffectedReturnsErrorWithoutBroadcast(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	expectTargetRole(mock, "member")
	mock.ExpectExec(`UPDATE chats\.members SET role`).
		WithArgs("admin", testChatID, testMemberID, "member").
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "admin")
	if !errors.Is(err, ErrStateUnchanged) {
		t.Fatalf("error = %v, want ErrStateUnchanged", err)
	}
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

func TestSetMemberRole_RowsAffectedErrorIsReturned(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	expectTargetRole(mock, "member")
	rowsErr := errors.New("rows affected unavailable")
	mock.ExpectExec(`UPDATE chats\.members SET role`).
		WithArgs("admin", testChatID, testMemberID, "member").
		WillReturnResult(sqlmock.NewErrorResult(rowsErr))

	err := svc.SetMemberRole(context.Background(), testActorID, testChatID, testMemberID, "admin")
	if !errors.Is(err, rowsErr) {
		t.Fatalf("error = %v, want %v", err, rowsErr)
	}
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

func TestRemoveMember_RoleRules(t *testing.T) {
	tests := []struct {
		name       string
		actorRole  string
		targetRole string
		allowed    bool
	}{
		{name: "owner removes admin", actorRole: "owner", targetRole: "admin", allowed: true},
		{name: "owner removes member", actorRole: "owner", targetRole: "member", allowed: true},
		{name: "admin removes member", actorRole: "admin", targetRole: "member", allowed: true},
		{name: "admin cannot remove admin", actorRole: "admin", targetRole: "admin", allowed: false},
		{name: "nobody can remove owner", actorRole: "owner", targetRole: "owner", allowed: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			expectActorInfo(mock, "group", tt.actorRole)
			expectTargetRole(mock, tt.targetRole)
			if tt.allowed {
				mock.ExpectExec(`DELETE FROM chats\.members`).
					WithArgs(testChatID, testMemberID, tt.targetRole).
					WillReturnResult(sqlmock.NewResult(0, 1))
			}

			err := svc.RemoveMember(context.Background(), testActorID, testChatID, testMemberID)
			if tt.allowed && err != nil {
				t.Fatalf("RemoveMember() error = %v", err)
			}
			if !tt.allowed && !errors.Is(err, ErrForbidden) {
				t.Fatalf("error = %v, want ErrForbidden", err)
			}
			wantBroadcasts := 0
			if tt.allowed {
				wantBroadcasts = 1
			}
			if len(realtime.broadcasts) != wantBroadcasts {
				t.Fatalf("broadcast count = %d, want %d", len(realtime.broadcasts), wantBroadcasts)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRemoveMember_MemberActorIsForbidden(t *testing.T) {
	svc, mock, _ := newMemberManagementService(t)
	expectActorInfo(mock, "group", "member")
	err := svc.RemoveMember(context.Background(), testActorID, testChatID, testMemberID)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("error = %v, want ErrForbidden", err)
	}
}

func TestRemoveMember_MemberNotFound(t *testing.T) {
	svc, mock, _ := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(testChatID, testMemberID).
		WillReturnError(sql.ErrNoRows)
	err := svc.RemoveMember(context.Background(), testActorID, testChatID, testMemberID)
	if !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("error = %v, want ErrMemberNotFound", err)
	}
}

func TestRemoveMember_BroadcastPayload(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	expectTargetRole(mock, "member")
	mock.ExpectExec(`DELETE FROM chats\.members`).
		WithArgs(testChatID, testMemberID, "member").
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := svc.RemoveMember(context.Background(), testActorID, testChatID, testMemberID); err != nil {
		t.Fatal(err)
	}
	var event MemberRemovedEvent
	if err := json.Unmarshal(realtime.broadcasts[0].payload, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "chat_member_removed" || event.ChatID != testChatID || event.UserID != testMemberID {
		t.Fatalf("unexpected event: %+v", event)
	}
}

func TestRemoveMember_NoRowsAffectedReturnsErrorWithoutBroadcast(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	expectActorInfo(mock, "group", "owner")
	expectTargetRole(mock, "member")
	mock.ExpectExec(`DELETE FROM chats\.members`).
		WithArgs(testChatID, testMemberID, "member").
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := svc.RemoveMember(context.Background(), testActorID, testChatID, testMemberID)
	if !errors.Is(err, ErrStateUnchanged) {
		t.Fatalf("error = %v, want ErrStateUnchanged", err)
	}
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

func TestRespondSuccess_MemberNotFound(t *testing.T) {
	req := httptest.NewRequest(http.MethodDelete, "/api/v2/chats/chat-id/members/member-id", bytes.NewReader(nil))
	recorder := httptest.NewRecorder()

	respondSuccess(recorder, req, ErrMemberNotFound)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != "member_not_found" {
		t.Fatalf("code = %q, want member_not_found", response.Code)
	}
}

// TestMuteMember_InvalidInput проверяет, что MuteMember отклоняет невалидный
// ввод (битые UUID, mutedUntil в прошлом) ошибкой ErrInvalidInput и не
// выполняет ни одного SQL-запроса: ExpectationsWereMet без ожиданий это
// доказывает. Прошедшая дата mute бессмысленна — mute либо активен, либо нет.
func TestMuteMember_InvalidInput(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	tests := []struct {
		name       string
		actorID    string
		chatID     string
		userID     string
		mutedUntil *time.Time
	}{
		{name: "невалидный actorID", actorID: "not-a-uuid", chatID: muteTestChatID, userID: muteTestUserID, mutedUntil: nil},
		{name: "невалидный chatID", actorID: muteTestActorID, chatID: "not-a-uuid", userID: muteTestUserID, mutedUntil: nil},
		{name: "невалидный userID", actorID: muteTestActorID, chatID: muteTestChatID, userID: "not-a-uuid", mutedUntil: nil},
		{name: "mutedUntil в прошлом", actorID: muteTestActorID, chatID: muteTestChatID, userID: muteTestUserID, mutedUntil: &past},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, _ := newMemberManagementService(t)
			err := svc.MuteMember(context.Background(), tt.actorID, tt.chatID, tt.userID, tt.mutedUntil)
			require.ErrorIs(t, err, ErrInvalidInput)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestMuteMember_ForbiddenWhenActorIsMember проверяет, что участник с ролью
// member не может мьютить других: сервис возвращает ErrForbidden и не
// выполняет UPDATE. Матрица прав: mute доступен только owner/admin.
func TestMuteMember_ForbiddenWhenActorIsMember(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
	err := svc.MuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil)
	require.ErrorIs(t, err, ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

// TestMuteMember_TargetNotMember проверяет, что mute несуществующего участника
// возвращает ErrNotFound (404 member_not_found), а не молчаливый success
func TestMuteMember_TargetNotMember(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnError(sql.ErrNoRows)
	err := svc.MuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil)
	require.ErrorIs(t, err, ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

// TestMuteMember_CannotModerateTarget проверяет иерархию модерации:
// нельзя мьютить owner; admin не может мьютить admin. Ожидается
// ErrCannotModerateTarget, UPDATE и WS-событие не выполняются.
func TestMuteMember_CannotModerateTarget(t *testing.T) {
	tests := []struct {
		name       string
		actorRole  string
		targetRole string
	}{
		{name: "owner мьютит owner", actorRole: "owner", targetRole: "owner"},
		{name: "admin мьютит admin", actorRole: "admin", targetRole: "admin"},
		{name: "admin мьютит owner", actorRole: "admin", targetRole: "owner"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestActorID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(tt.actorRole))
			mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestUserID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow(tt.targetRole, nil, nil))

			err := svc.MuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil)
			require.ErrorIs(t, err, ErrCannotModerateTarget)
			require.NoError(t, mock.ExpectationsWereMet())
			if len(realtime.broadcasts) != 0 {
				t.Fatal("unexpected broadcast")
			}
		})
	}
}

// TestMuteMember_Success проверяет успешный mute: owner мьютит member —
// выполняется UPDATE muted_at/muted_until и в чат уходит событие
// chat_member_muted с mutedUntil. Временный и перманентный (nil) mute.
func TestMuteMember_Success(t *testing.T) {
	future := time.Now().Add(time.Hour)
	tests := []struct {
		name       string
		mutedUntil *time.Time
	}{
		{name: "временный mute", mutedUntil: &future},
		{name: "перманентный mute", mutedUntil: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestActorID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestUserID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow("member", nil, nil))
			mock.ExpectExec(`UPDATE chats\.members SET muted_at = NOW\(\), muted_until = \$3 WHERE chat_id = \$1 AND user_id = \$2`).
				WithArgs(muteTestChatID, muteTestUserID, tt.mutedUntil).
				WillReturnResult(sqlmock.NewResult(0, 1))
			err := svc.MuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, tt.mutedUntil)
			require.NoError(t, err)
			require.Len(t, realtime.broadcasts, 1)
			var event MemberMuteEvent
			err = json.Unmarshal(realtime.broadcasts[0].payload, &event)
			require.NoError(t, err)
			require.Equal(t, "chat_member_muted", event.Type)
			require.Equal(t, muteTestChatID, event.ChatID)
			require.Equal(t, muteTestUserID, event.UserID)
			require.Equal(t, muteTestActorID, event.ByUserID)
			if tt.mutedUntil == nil {
				require.Nil(t, event.MutedUntil)
			} else {
				require.NotNil(t, event.MutedUntil)
				require.True(t, event.MutedUntil.Equal(*tt.mutedUntil))
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestMuteMember_Idempotent проверяет, что повторный mute с тем же целевым
// состоянием не выполняет UPDATE и не публикует WS-событие (200 success без
// шума), а mute с другим mutedUntil — обновляет и публикует. Критерий
// приёмки: повторная операция не создаёт ложное WebSocket-событие.
func TestMuteMember_Idempotent(t *testing.T) {
	now := time.Now()
	future := time.Now().Add(time.Hour)
	future2 := time.Now().Add(time.Minute)
	tests := []struct {
		name              string
		mutedAt           *time.Time
		currentMutedUntil *time.Time
		newMutedUntil     *time.Time
		wantUpdate        bool
	}{
		{name: "повторный перманентный mute", mutedAt: &now, currentMutedUntil: nil, newMutedUntil: nil, wantUpdate: false},
		{name: "повторный mute с тем же сроком", mutedAt: &now, currentMutedUntil: &future, newMutedUntil: &future, wantUpdate: false},
		{name: "mute с другим сроком", mutedAt: &now, currentMutedUntil: &future, newMutedUntil: &future2, wantUpdate: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestActorID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestUserID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow("member", tt.mutedAt, tt.currentMutedUntil))
			if tt.wantUpdate {
				mock.ExpectExec(`UPDATE chats\.members SET muted_at = NOW\(\), muted_until = \$3 WHERE chat_id = \$1 AND user_id = \$2`).
					WithArgs(muteTestChatID, muteTestUserID, tt.newMutedUntil).
					WillReturnResult(sqlmock.NewResult(0, 1))
			}
			err := svc.MuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, tt.newMutedUntil)
			require.NoError(t, err)

			if tt.wantUpdate {
				require.Len(t, realtime.broadcasts, 1)
				var event MemberMuteEvent
				err = json.Unmarshal(realtime.broadcasts[0].payload, &event)
				require.NoError(t, err)
				require.Equal(t, "chat_member_muted", event.Type)
				require.Equal(t, muteTestChatID, event.ChatID)
				require.Equal(t, muteTestUserID, event.UserID)
				require.Equal(t, muteTestActorID, event.ByUserID)
			} else {
				require.Empty(t, realtime.broadcasts)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestUnmuteMember_InvalidInput проверяет, что UnmuteMember отклоняет
// невалидные UUID ошибкой ErrInvalidInput и не выполняет ни одного
// SQL-запроса. Валидация на уровне сервиса — часть критерия «некорректные
// UUID не приводят к 500».
func TestUnmuteMember_InvalidInput(t *testing.T) {
	tests := []struct {
		name    string
		actorID string
		chatID  string
		userID  string
	}{
		{name: "невалидный actorID", actorID: "not-a-uuid", chatID: muteTestChatID, userID: muteTestUserID},
		{name: "невалидный chatID", actorID: muteTestActorID, chatID: "not-a-uuid", userID: muteTestUserID},
		{name: "невалидный userID", actorID: muteTestActorID, chatID: muteTestChatID, userID: "not-a-uuid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, _ := newMemberManagementService(t)
			err := svc.UnmuteMember(context.Background(), tt.actorID, tt.chatID, tt.userID)
			require.ErrorIs(t, err, ErrInvalidInput)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestUnmuteMember_ForbiddenWhenActorIsMember проверяет, что member не может
// снимать mute: ErrForbidden, без UPDATE и WS-события.
func TestUnmuteMember_ForbiddenWhenActorIsMember(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
	err := svc.UnmuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.ErrorIs(t, err, ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

// TestUnmuteMember_TargetNotMember проверяет, что unmute несуществующего
// участника возвращает ErrNotFound (404), а не молчаливый success.
func TestUnmuteMember_TargetNotMember(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnError(sql.ErrNoRows)
	err := svc.UnmuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.ErrorIs(t, err, ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
	if len(realtime.broadcasts) != 0 {
		t.Fatal("unexpected broadcast")
	}
}

// TestUnmuteMember_CannotModerateTarget проверяет иерархию для unmute:
// нельзя снимать mute с owner; admin не может у admin. Ожидается
// ErrCannotModerateTarget, UPDATE и событие не выполняются.
func TestUnmuteMember_CannotModerateTarget(t *testing.T) {
	tests := []struct {
		name       string
		actorRole  string
		targetRole string
	}{
		{name: "owner снимает mute с owner", actorRole: "owner", targetRole: "owner"},
		{name: "admin снимает mute с admin", actorRole: "admin", targetRole: "admin"},
		{name: "admin снимает mute с owner", actorRole: "admin", targetRole: "owner"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestActorID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(tt.actorRole))
			mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestUserID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow(tt.targetRole, nil, nil))

			err := svc.UnmuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
			require.ErrorIs(t, err, ErrCannotModerateTarget)
			require.NoError(t, mock.ExpectationsWereMet())
			if len(realtime.broadcasts) != 0 {
				t.Fatal("unexpected broadcast")
			}
		})
	}
}

// TestUnmuteMember_NotMutedIsIdempotent проверяет, что unmute незамьюченного
// участника возвращает success без UPDATE и без WS-события: повторная
// операция не создаёт ложное событие.
func TestUnmuteMember_NotMutedIsIdempotent(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow("member", nil, nil))
	err := svc.UnmuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.NoError(t, err)
	require.Empty(t, realtime.broadcasts)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestUnmuteMember_Success проверяет успешный unmute: owner снимает mute с
// member — UPDATE обнуляет muted_at/muted_until и в чат уходит событие
// chat_member_unmuted.
func TestUnmuteMember_Success(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)

	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role, muted_at, muted_until FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted_at", "muted_until"}).AddRow("member", time.Now(), nil))
	mock.ExpectExec(`UPDATE chats\.members SET muted_at = NULL, muted_until = NULL WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.UnmuteMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.NoError(t, err)
	require.Len(t, realtime.broadcasts, 1)
	var event MemberMuteEvent
	err = json.Unmarshal(realtime.broadcasts[0].payload, &event)
	require.NoError(t, err)
	require.Equal(t, "chat_member_unmuted", event.Type)
	require.Equal(t, muteTestChatID, event.ChatID)
	require.Equal(t, muteTestUserID, event.UserID)
	require.Equal(t, muteTestActorID, event.ByUserID)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestBanMember_InvalidInput проверяет, что BanMember отклоняет невалидный
// ввод (битые UUID, bannedUntil в прошлом, reason длиннее 500 символов)
// ошибкой ErrInvalidInput и не выполняет ни одного SQL-запроса. Лимит
// reason — 500
func TestBanMember_InvalidInput(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	tests := []struct {
		name        string
		actorID     string
		chatID      string
		userID      string
		bannedUntil *time.Time
		reason      string
	}{
		{name: "невалидный actorID", actorID: "not-a-uuid", chatID: muteTestChatID, userID: muteTestUserID, bannedUntil: nil, reason: "ban"},
		{name: "невалидный chatID", actorID: muteTestActorID, chatID: "not-a-uuid", userID: muteTestUserID, bannedUntil: nil, reason: "ban"},
		{name: "невалидный userID", actorID: muteTestActorID, chatID: muteTestChatID, userID: "not-a-uuid", bannedUntil: nil, reason: "ban"},
		{name: "bannedUntil в прошлом", actorID: muteTestActorID, chatID: muteTestChatID, userID: muteTestUserID, bannedUntil: &past, reason: "ban"},
		{name: "reason слишком длинный", actorID: muteTestActorID, chatID: muteTestChatID, userID: muteTestUserID, bannedUntil: nil, reason: strings.Repeat("a", 501)},
		{name: "reason 501 кириллический символ", actorID: muteTestActorID, chatID: muteTestChatID, userID: muteTestUserID, bannedUntil: nil, reason: strings.Repeat("я", 501)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, _ := newMemberManagementService(t)
			err := svc.BanMember(context.Background(), tt.actorID, tt.chatID, tt.userID, tt.bannedUntil, tt.reason)
			require.ErrorIs(t, err, ErrInvalidInput)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestBanMember_ForbiddenWhenActorIsMember проверяет, что member не может
// банить: ErrForbidden, без транзакции и WS-событий.
func TestBanMember_ForbiddenWhenActorIsMember(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
	err := svc.BanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil, "spam")
	require.ErrorIs(t, err, ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
	require.Len(t, realtime.broadcasts, 0)
}

// TestBanMember_CannotModerateTarget проверяет иерархию для ban:
// нельзя банить owner; admin не может банить admin. Ожидается
// ErrCannotModerateTarget; транзакция не открывается, событий нет.
func TestBanMember_CannotModerateTarget(t *testing.T) {
	tests := []struct {
		name       string
		actorRole  string
		targetRole string
	}{
		{name: "owner банит owner", actorRole: "owner", targetRole: "owner"},
		{name: "admin банит admin", actorRole: "admin", targetRole: "admin"},
		{name: "admin банит owner", actorRole: "admin", targetRole: "owner"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestActorID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(tt.actorRole))
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestUserID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(tt.targetRole))

			err := svc.BanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil, "spam")
			require.ErrorIs(t, err, ErrCannotModerateTarget)
			require.NoError(t, mock.ExpectationsWereMet())
			require.Len(t, realtime.broadcasts, 0)
		})
	}
}

// TestBanMember_UserNotFound проверяет, что ban пользователя, которого нет
// в auth.users, возвращает ErrUserNotFound (404 user_not_found) до открытия
// транзакции: нельзя банить несуществующий аккаунт.
func TestBanMember_UserNotFound(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)

	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users WHERE id = \$1\)`).
		WithArgs(muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	err := svc.BanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil, "spam")
	require.ErrorIs(t, err, ErrUserNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
	require.Len(t, realtime.broadcasts, 0)
}

// TestBanMember_PreventiveBan проверяет превентивный ban: пользователь
// существует в auth.users, но не участник — создаётся запись в chats.bans
// и в чат уходит chat_member_banned. chat_member_removed и адресное
// событие НЕ отправляются: удалять некого.
func TestBanMember_PreventiveBan(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users WHERE id = \$1\)`).
		WithArgs(muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// Проверка существующего бана (нужна для идемпотентности)
	mock.ExpectQuery(`SELECT banned_until, reason FROM chats\.bans WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO chats\.bans \(chat_id, user_id, banned_by, reason, banned_until\) VALUES \(\$1, \$2, \$3, \$4, \$5\)`).
		WithArgs(muteTestChatID, muteTestUserID, muteTestActorID, "spam", nil).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	err := svc.BanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil, "spam")
	require.NoError(t, err)
	require.Len(t, realtime.broadcasts, 1)
	var event MemberBanEvent
	err = json.Unmarshal(realtime.broadcasts[0].payload, &event)
	require.NoError(t, err)
	require.Equal(t, "chat_member_banned", event.Type)
	require.Equal(t, muteTestChatID, event.ChatID)
	require.Equal(t, muteTestUserID, event.UserID)
	require.Equal(t, muteTestActorID, event.ByUserID)
	require.Equal(t, "spam", event.Reason)
	require.Nil(t, event.BannedUntil)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestBanMember_BansExistingMember проверяет ban существующего участника:
// в транзакции DELETE из chats.members + INSERT в chats.bans; в чат уходят
// chat_member_banned и chat_member_removed (reason "banned"), забаненному
// адресно — chat_member_banned через BroadcastToUsers.
func TestBanMember_BansExistingMember(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestUserID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
	// Проверка существующего бана (нужна для идемпотентности)
	mock.ExpectQuery(`SELECT banned_until, reason FROM chats\.bans WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM chats\.members WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO chats\.bans \(chat_id, user_id, banned_by, reason, banned_until\) VALUES \(\$1, \$2, \$3, \$4, \$5\)`).
		WithArgs(muteTestChatID, muteTestUserID, muteTestActorID, "spam", nil).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	err := svc.BanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, nil, "spam")
	require.NoError(t, err)
	require.Len(t, realtime.broadcasts, 3)

	// [0] — chat_member_banned всему чату
	require.Equal(t, muteTestChatID, realtime.broadcasts[0].chatID)
	var banned MemberBanEvent
	require.NoError(t, json.Unmarshal(realtime.broadcasts[0].payload, &banned))
	require.Equal(t, "chat_member_banned", banned.Type)
	require.Equal(t, muteTestUserID, banned.UserID)
	require.Equal(t, muteTestActorID, banned.ByUserID)

	// [1] — chat_member_removed всему чату
	require.Equal(t, muteTestChatID, realtime.broadcasts[1].chatID)
	var removed MemberRemovedEvent
	require.NoError(t, json.Unmarshal(realtime.broadcasts[1].payload, &removed))
	require.Equal(t, "chat_member_removed", removed.Type)
	require.Equal(t, "banned", removed.Reason)

	// [2] — адресное забаненному: chatID записи == userID
	require.Equal(t, muteTestUserID, realtime.broadcasts[2].chatID)
	var personal MemberBanEvent
	require.NoError(t, json.Unmarshal(realtime.broadcasts[2].payload, &personal))
	require.Equal(t, "chat_member_banned", personal.Type)

	require.NoError(t, mock.ExpectationsWereMet())
}

// TestBanMember_Idempotent проверяет идемпотентность ban: активный ban с
// теми же bannedUntil+reason → success без записи и событий; с другими
// параметрами или истёкший ban → UPDATE chats.bans + chat_member_banned.
// Слепой ON CONFLICT DO UPDATE не позволял отличить повтор — поэтому
// состояние читается явно.
func TestBanMember_Idempotent(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	future2 := time.Now().Add(time.Minute)
	tests := []struct {
		name       string
		curUntil   *time.Time
		newUntil   *time.Time
		curReason  string
		newReason  string
		wantUpdate bool
	}{
		{name: "повтор перманентного", curUntil: nil, newUntil: nil, curReason: "spam", newReason: "spam", wantUpdate: false},
		{name: "повтор с тем же сроком", curUntil: &future, newUntil: &future, curReason: "spam", newReason: "spam", wantUpdate: false},
		{name: "другая причина", curUntil: nil, newUntil: nil, curReason: "spam", newReason: "other", wantUpdate: true},
		{name: "другой срок", curUntil: &future, newUntil: &future2, curReason: "spam", newReason: "spam", wantUpdate: true},
		{name: "истёкший ban", curUntil: &past, newUntil: nil, curReason: "spam", newReason: "spam", wantUpdate: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, realtime := newMemberManagementService(t)
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestActorID, muteTestChatID).
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
				WithArgs(muteTestUserID, muteTestChatID).
				WillReturnError(sql.ErrNoRows)
			mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users WHERE id = \$1\)`).
				WithArgs(muteTestUserID).
				WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			mock.ExpectQuery(`SELECT banned_until, reason FROM chats\.bans WHERE chat_id = \$1 AND user_id = \$2`).
				WithArgs(muteTestChatID, muteTestUserID).
				WillReturnRows(sqlmock.NewRows([]string{"banned_until", "reason"}).AddRow(tt.curUntil, tt.curReason))

			if tt.wantUpdate {
				mock.ExpectBegin()
				mock.ExpectExec(`UPDATE chats\.bans SET banned_by = \$3, reason = \$4, banned_until = \$5, created_at = NOW\(\) WHERE chat_id = \$1 AND user_id = \$2`).
					WithArgs(muteTestChatID, muteTestUserID, muteTestActorID, tt.newReason, tt.newUntil).
					WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			}
			err := svc.BanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID, tt.newUntil, tt.newReason)
			require.NoError(t, err)

			if tt.wantUpdate {
				require.Len(t, realtime.broadcasts, 1)
				var event MemberBanEvent
				err = json.Unmarshal(realtime.broadcasts[0].payload, &event)
				require.NoError(t, err)
				require.Equal(t, "chat_member_banned", event.Type)
				require.Equal(t, muteTestChatID, event.ChatID)
				require.Equal(t, muteTestUserID, event.UserID)
				require.Equal(t, muteTestActorID, event.ByUserID)
				require.Equal(t, tt.newReason, event.Reason)
				if tt.newUntil == nil {
					require.Nil(t, event.BannedUntil)
				} else {
					require.True(t, event.BannedUntil.Equal(*tt.newUntil))
				}
			} else {
				require.Empty(t, realtime.broadcasts)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestUnbanMember_InvalidInput проверяет, что UnbanMember отклоняет
// невалидные UUID ошибкой ErrInvalidInput и не выполняет ни одного SQL-запроса.
func TestUnbanMember_InvalidInput(t *testing.T) {
	tests := []struct {
		name    string
		actorID string
		chatID  string
		userID  string
	}{
		{name: "невалидный actorID", actorID: "not-a-uuid", chatID: muteTestChatID, userID: muteTestUserID},
		{name: "невалидный chatID", actorID: muteTestActorID, chatID: "not-a-uuid", userID: muteTestUserID},
		{name: "невалидный userID", actorID: muteTestActorID, chatID: muteTestChatID, userID: "not-a-uuid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, _ := newMemberManagementService(t)
			err := svc.UnbanMember(context.Background(), tt.actorID, tt.chatID, tt.userID)
			require.ErrorIs(t, err, ErrInvalidInput)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestUnbanMember_ForbiddenWhenActorIsMember проверяет, что member не может
// снимать ban: ErrForbidden, без DELETE и WS-событий.
func TestUnbanMember_ForbiddenWhenActorIsMember(t *testing.T) {
	svc, mock, _ := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))

	err := svc.UnbanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.ErrorIs(t, err, ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestUnbanMember_UserNotFound проверяет, что unban пользователя, которого
// нет в auth.users, возвращает ErrUserNotFound (404): нельзя разбанить несуществующий аккаунт.
func TestUnbanMember_UserNotFound(t *testing.T) {
	svc, mock, _ := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users WHERE id = \$1\)`).
		WithArgs(muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	err := svc.UnbanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.ErrorIs(t, err, ErrUserNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestUnbanMember_NotBannedIsIdempotent проверяет, что unban незабаненного
// (нет активной строки в chats.bans) возвращает success без DELETE и без WS-события.
func TestUnbanMember_NotBannedIsIdempotent(t *testing.T) {
	svc, mock, _ := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users WHERE id = \$1\)`).
		WithArgs(muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// Проверка существующего бана (нужна для идемпотентности)
	mock.ExpectQuery(`SELECT banned_until FROM chats\.bans WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnError(sql.ErrNoRows)

	err := svc.UnbanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestUnbanMember_Success проверяет успешный unban: owner снимает ban —
// выполняется DELETE из chats.bans и в чат уходит событие
// chat_member_unbanned. Пользователь обратно в группу НЕ добавляется
// (критерий приёмки: unban не добавляет автоматически).
func TestUnbanMember_Success(t *testing.T) {
	svc, mock, realtime := newMemberManagementService(t)
	mock.ExpectQuery(`SELECT role FROM chats\.members WHERE user_id = \$1 AND chat_id = \$2`).
		WithArgs(muteTestActorID, muteTestChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users WHERE id = \$1\)`).
		WithArgs(muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// Проверка существующего бана
	mock.ExpectQuery(`SELECT banned_until FROM chats\.bans WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"banned_until"}).AddRow(nil))
	mock.ExpectExec(`DELETE FROM chats\.bans WHERE chat_id = \$1 AND user_id = \$2`).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.UnbanMember(context.Background(), muteTestActorID, muteTestChatID, muteTestUserID)
	require.NoError(t, err)
	require.Len(t, realtime.broadcasts, 1)
	var event MemberBanEvent
	err = json.Unmarshal(realtime.broadcasts[0].payload, &event)
	require.NoError(t, err)
	require.Equal(t, "chat_member_unbanned", event.Type)
	require.Equal(t, muteTestChatID, event.ChatID)
	require.Equal(t, muteTestUserID, event.UserID)
	require.Equal(t, muteTestActorID, event.ByUserID)
	require.NoError(t, mock.ExpectationsWereMet())
}
