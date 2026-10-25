package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	blockerID = "00000000-0000-0000-0000-000000000001"
	blockedID = "00000000-0000-0000-0000-000000000002"
)

// Блокировка и её снятие доходят до обоих (#760).
func TestBroadcastBlockChange(t *testing.T) {
	for name, tt := range map[string]struct {
		blocked  bool
		chatRows *sqlmock.Rows
		wantType string
		wantChat string
	}{
		"блокировка — с личным чатом": {
			blocked: true, chatRows: sqlmock.NewRows([]string{"id"}).AddRow("chat-1"),
			wantType: "user_blocked", wantChat: "chat-1",
		},
		"снятие блокировки": {
			blocked: false, chatRows: sqlmock.NewRows([]string{"id"}).AddRow("chat-1"),
			wantType: "user_unblocked", wantChat: "chat-1",
		},
		"личного чата нет — событие всё равно уходит": {
			blocked: true, chatRows: sqlmock.NewRows([]string{"id"}),
			wantType: "user_blocked", wantChat: "",
		},
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			mock.ExpectQuery(`(?s)FROM chats\.chats c.*c\.type = 'private'`).WithArgs(blockerID, blockedID).WillReturnRows(tt.chatRows)
			broadcaster := &profileChangeBroadcaster{}
			event, _ := json.Marshal(map[string]any{"userId": blockerID, "blockedUserId": blockedID, "blocked": tt.blocked})

			require.NoError(t, broadcastBlockChange(context.Background(), db, broadcaster, string(event)))

			require.ElementsMatch(t, []string{blockerID, blockedID}, broadcaster.recipients)
			var payload map[string]any
			require.NoError(t, json.Unmarshal(broadcaster.payload, &payload))
			require.Equal(t, map[string]any{
				"type": tt.wantType, "userId": blockerID, "blockedUserId": blockedID, "chatId": tt.wantChat,
			}, payload)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}

	t.Run("неполное событие не рассылается", func(t *testing.T) {
		broadcaster := &profileChangeBroadcaster{}
		require.Error(t, broadcastBlockChange(context.Background(), nil, broadcaster, `{"userId":"`+blockerID+`"}`))
		require.Nil(t, broadcaster.recipients)
	})
}

func TestSendMessageAnswersBlockedByUser(t *testing.T) {
	handler, mock := messageValidationHandler(t)
	mock.ExpectQuery(`SELECT cm\.role`).
		WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted", "blocked_by_peer", "chat_type"}).AddRow("member", false, true, "private"))

	recorder := httptest.NewRecorder()
	handler.SendMessage(recorder, messageValidationRequest(
		http.MethodPost, "/api/v2/messages/"+messageValidationChatID, sendBody(`{"type":"text","content":"привет"}`),
		"chatId", messageValidationChatID,
	))

	assertErrorResponse(t, recorder, http.StatusForbidden, "blocked_by_user")
	require.NoError(t, mock.ExpectationsWereMet())
}

// Звонок заблокированного не доходит; звонящему — отказ (#760).
func TestCallInviteFromBlockedUserIsRefused(t *testing.T) {
	// Звонящий — создатель комнаты, получатель — собеседник её чата (#850):
	// до проверки блокировки сервер сверяет, что они собеседники.
	expectPeers := func(mock sqlmock.Sqlmock) {
		mock.ExpectQuery(`FROM chats\.chats c`).WithArgs("chat-1", blockedID, blockerID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	}
	newServer := func(db *sql.DB) *WSServer {
		ws := presenceServer(nil)
		ws.db = db
		ws.callRooms = NewCallRoomManager()
		ws.callRooms.CreateRoom(blockedID, "room-1", "p2p", "audio", "chat-1", "")
		ws.pendingInvites = map[string]*pendingInvite{}
		return ws
	}

	for name, tt := range map[string]struct {
		blocked      bool
		wantIncoming bool
	}{
		"заблокирован — отказ":        {blocked: true},
		"не заблокирован — доставлен": {blocked: false, wantIncoming: true},
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			expectPeers(mock)
			mock.ExpectQuery(`FROM auth\.users`).WithArgs(blockerID, blockedID).
				WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "blocked", "exceptions"}).AddRow([]byte(`{}`), tt.blocked, nil))
			if tt.wantIncoming {
				mock.ExpectQuery(`FROM auth\.users au`).WithArgs(blockedID).
					WillReturnRows(sqlmock.NewRows([]string{"name", "avatar"}).AddRow("Игорь", ""))
			}
			ws := newServer(db)
			caller := connectLocal(ws, blockedID)
			callee := connectLocal(ws, blockerID)

			ws.handleCallInvite(caller, map[string]interface{}{"to": blockerID, "roomId": "room-1"})

			if tt.wantIncoming {
				require.Equal(t, "call_incoming", receivedEvent(t, callee)["type"])
				requireNoEvent(t, caller)
				ws.inviteMu.Lock()
				ws.pendingInvites[blockerID].timer.Stop()
				ws.inviteMu.Unlock()
			} else {
				refused := receivedEvent(t, caller)
				require.Equal(t, "call_invite_response", refused["type"])
				require.Equal(t, "blocked_by_user", refused["reason"])
				require.Equal(t, false, refused["accepted"])
				requireNoEvent(t, callee)
				require.Empty(t, ws.pendingInvites, "и в отложенные приглашения не попал")
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}

	t.Run("сбой базы — приглашение не уходит", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(`FROM chats\.chats c`).WillReturnError(sql.ErrConnDone)
		ws := newServer(db)
		caller := connectLocal(ws, blockedID)
		callee := connectLocal(ws, blockerID)

		ws.handleCallInvite(caller, map[string]interface{}{"to": blockerID, "roomId": "room-1"})

		requireNoEvent(t, callee)
		requireNoEvent(t, caller)
		require.Empty(t, ws.pendingInvites)
	})
}
