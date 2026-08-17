package chat

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
			var event MemberMutedEvent
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
				var event MemberMutedEvent
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
