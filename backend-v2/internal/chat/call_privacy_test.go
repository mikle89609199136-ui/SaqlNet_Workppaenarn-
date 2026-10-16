package chat

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
)

func TestCallPrivacyReadFailureDeniesWithoutSideEffects(t *testing.T) {
	const callerID = "aaaaaaaa-4714-4714-8714-111111111111"
	const calleeID = "bbbbbbbb-4714-4714-8714-222222222222"
	const chatID = "cccccccc-4714-4714-8714-333333333333"
	for _, phase := range []string{"create", "invite", "join", "restore"} {
		t.Run(phase, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })
			ws := presenceServer(nil)
			ws.db = db
			ws.callRooms = NewCallRoomManager()
			ws.pendingInvites = make(map[string]*pendingInvite)
			caller := connectLocal(ws, callerID)
			callee := connectLocal(ws, calleeID)
			pushed := &recordingPush{}
			ws.SetPush(pushed)
			switch phase {
			case "create":
				mock.ExpectQuery(`SELECT c\.type`).WithArgs(chatID, callerID).
					WillReturnRows(sqlmock.NewRows([]string{"type", "peer"}).AddRow("private", calleeID))
			case "invite":
				ws.callRooms.CreateRoom(callerID, "room-714", "p2p", "audio", chatID, "")
				mock.ExpectQuery(`FROM chats\.chats c`).WithArgs(chatID, callerID, calleeID).
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			case "join", "restore":
				if phase == "restore" {
					ws.callRooms.AddRestorable(RestorableRoom{ID: "room-714", HostID: callerID, CalleeID: calleeID, ChatID: chatID})
				} else {
					ws.callRooms.CreateRoom(callerID, "room-714", "p2p", "audio", chatID, "")
				}
				mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chats\.members`).WithArgs(callerID, chatID).
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectQuery(`SELECT user_id::text FROM chats\.members`).WithArgs(chatID, callerID).
					WillReturnRows(sqlmock.NewRows([]string{"peer"}).AddRow(calleeID))
			}
			mock.ExpectQuery(`FROM auth\.users`).WithArgs(calleeID, callerID).WillReturnError(sql.ErrConnDone)
			switch phase {
			case "create":
				req := httptest.NewRequest(http.MethodPost, "/api/v2/calls/rooms", strings.NewReader(`{"chatId":"`+chatID+`"}`))
				req = req.WithContext(authctx.WithUser(context.Background(), authctx.User{ID: callerID}))
				rec := httptest.NewRecorder()
				NewHandler(NewService(db, ws, nil)).CallRoom(rec, req)
				require.Equal(t, http.StatusInternalServerError, rec.Code)
				require.Contains(t, rec.Body.String(), `"internal_error"`)
				require.Empty(t, ws.callRooms.rooms)
			case "invite":
				ws.handleCallInvite(caller, map[string]interface{}{"to": calleeID, "roomId": "room-714"})
				require.Equal(t, "calls_forbidden", receivedEvent(t, caller)["reason"])
			case "join", "restore":
				ws.handleCallJoin(caller, map[string]interface{}{"roomId": "room-714"})
				require.Equal(t, "calls_forbidden", receivedEvent(t, caller)["reason"])
				require.Nil(t, ws.callRooms.GetRoomPublic("room-714"))
				if phase == "restore" {
					require.Len(t, ws.callRooms.restorable, 1)
				}
			}
			requireNoEvent(t, callee)
			require.Empty(t, ws.pendingInvites)
			require.Empty(t, pushed.events)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestPrivacyDenialDoesNotCloseAnsweredCall(t *testing.T) {
	ws := &WSServer{callRooms: NewCallRoomManager()}
	ws.callRooms.CreateRoom("caller", "answered-room", "p2p", "audio", "chat", "")
	require.True(t, ws.callRooms.JoinRoom("answered-room", "caller", "", "").OK)
	require.True(t, ws.callRooms.JoinRoom("answered-room", "callee", "", "").OK)
	// Даже если собеседник временно вышел, отвеченный звонок сохраняется.
	require.True(t, ws.callRooms.LeaveRoom("answered-room", "callee").OK)
	ws.closeDeniedCallRoom("answered-room", "caller")
	require.NotNil(t, ws.callRooms.GetRoomPublic("answered-room"))
	require.NotNil(t, ws.callRooms.GetUserRoom("caller"))
	require.True(t, ws.callRooms.IsParticipant("answered-room", "caller"))
}
