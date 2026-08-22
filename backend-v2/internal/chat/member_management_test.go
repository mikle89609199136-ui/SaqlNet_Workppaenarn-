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

	"github.com/DATA-DOG/go-sqlmock"
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
	testActorID  = "actor-id"
	testChatID   = "chat-id"
	testMemberID = "member-id"
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
