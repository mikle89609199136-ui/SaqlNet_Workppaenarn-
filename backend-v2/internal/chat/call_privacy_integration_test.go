//go:build integration

package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/privacy"
	"craneapp/backend-v2/internal/user"
)

// #714: the same recipient policy protects REST, signaling, replay and join.
func TestCallPrivacyOnRealSchema(t *testing.T) {
	const callerID = "aaaaaaaa-4714-4714-8714-111111111111"
	const calleeID = "bbbbbbbb-4714-4714-8714-222222222222"
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, callerID, "privacy_caller")
	dbtest.User(t, db, calleeID, "privacy_callee")
	ws := &WSServer{db: db, clients: make(map[string]map[*Client]bool), callRooms: NewCallRoomManager(), pendingInvites: make(map[string]*pendingInvite)}
	chats := NewService(db, ws, nil)
	users := user.NewService(db)
	handler := NewHandler(chats)
	chatID, _, err := chats.CreatePrivate(ctx, callerID, calleeID)
	require.NoError(t, err)
	caller := connectLocal(ws, callerID)
	callee := connectLocal(ws, calleeID)
	pushed := &recordingPush{}
	ws.SetPush(pushed)
	t.Cleanup(func() {
		ws.inviteMu.Lock()
		defer ws.inviteMu.Unlock()
		for _, invite := range ws.pendingInvites {
			invite.timer.Stop()
		}
	})
	set := func(raw string) {
		t.Helper()
		_, err := db.Exec(`INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, $2::jsonb)
			ON CONFLICT (user_id) DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings`, calleeID, raw)
		require.NoError(t, err)
	}
	create := func(who string) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/v2/calls/rooms", strings.NewReader(`{"chatId":"`+chatID+`","callKind":"audio"}`))
		req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: who}))
		rec := httptest.NewRecorder()
		handler.CallRoom(rec, req)
		var out map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
		return rec.Code, out
	}
	counts := func() []int {
		t.Helper()
		out := make([]int, 3)
		for i, table := range []string{"calls.rooms", "calls.participants", "messages.messages"} {
			require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM `+table).Scan(&out[i]))
		}
		return out
	}
	reset := func() {
		t.Helper()
		_, err := db.Exec(`DELETE FROM users.privacy_exceptions; DELETE FROM users.blocked_users; DELETE FROM users.settings`)
		require.NoError(t, err)
		ws.callRooms = NewCallRoomManager()
		ws.inviteMu.Lock()
		for _, invite := range ws.pendingInvites {
			invite.timer.Stop()
		}
		ws.pendingInvites = make(map[string]*pendingInvite)
		ws.inviteMu.Unlock()
		for len(caller.Send) > 0 {
			<-caller.Send
		}
		for len(callee.Send) > 0 {
			<-callee.Send
		}
		pushed.events = nil
	}
	for _, tc := range []struct {
		name, raw, mode  string
		blocked, allowed bool
	}{
		{name: "missing settings use default", allowed: true},
		{name: "all", raw: `{"calls":"all"}`, allowed: true},
		{name: "nobody", raw: `{"calls":"nobody"}`},
		{name: "always allow", raw: `{"calls":"nobody"}`, mode: "allow", allowed: true},
		{name: "never allow", raw: `{"calls":"all"}`, mode: "deny"},
		{name: "block overrides exception", raw: `{"calls":"all"}`, mode: "allow", blocked: true},
		{name: "legacy everyone", raw: `{"calls":"everyone"}`, allowed: true},
		{name: "legacy contacts", raw: `{"calls":"contacts"}`},
		{name: "invalid enum", raw: `{"calls":"friends"}`},
		{name: "invalid type", raw: `{"calls":42}`},
		{name: "explicit null", raw: `{"calls":null}`},
		{name: "null document", raw: `null`},
		{name: "array document", raw: `[]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reset()
			if tc.raw != "" {
				set(tc.raw)
			}
			if tc.mode != "" {
				_, err := users.SetPrivacyException(ctx, calleeID, privacy.Calls, callerID, tc.mode == "allow")
				require.NoError(t, err)
			}
			if tc.blocked {
				_, err := db.Exec(`INSERT INTO users.blocked_users (user_id,blocked_user_id) VALUES ($1,$2)`, calleeID, callerID)
				require.NoError(t, err)
			}
			before := counts()
			code, out := create(callerID)
			if tc.allowed {
				require.Equal(t, http.StatusCreated, code, out)
				roomID := out["room"].(map[string]any)["id"].(string)
				ws.handleCallInvite(caller, map[string]interface{}{"to": calleeID, "roomId": roomID})
				require.Equal(t, "call_incoming", receivedEvent(t, callee)["type"])
				require.Len(t, ws.pendingInvites, 1)
				require.Len(t, pushed.events, 1)
			} else {
				require.Equal(t, http.StatusForbidden, code, out)
				want := "calls_forbidden"
				if tc.blocked {
					want = "blocked_by_user"
				}
				require.Equal(t, want, out["code"])
				require.Equal(t, before, counts(), "no room, participant or message writes")
				require.Empty(t, ws.callRooms.rooms)
				require.Empty(t, ws.pendingInvites)
				require.Empty(t, pushed.events)
				requireNoEvent(t, caller)
				requireNoEvent(t, callee)
			}
		})
	}
	t.Run("outgoing policy uses recipient only", func(t *testing.T) {
		reset()
		set(`{"calls":"nobody"}`)
		code, _ := create(calleeID)
		require.Equal(t, http.StatusCreated, code)
	})
	t.Run("policy change before invite hides busy and writes nothing", func(t *testing.T) {
		for _, busy := range []bool{false, true} {
			reset()
			code, out := create(callerID)
			require.Equal(t, http.StatusCreated, code)
			roomID := out["room"].(map[string]any)["id"].(string)
			if busy {
				ws.callRooms.CreateRoom(calleeID, "busy-room", "p2p", "audio", chatID, "")
				require.True(t, ws.callRooms.JoinRoom("busy-room", calleeID, "", "").OK)
			}
			set(`{"calls":"nobody"}`)
			before := counts()
			ws.handleCallInvite(caller, map[string]interface{}{"to": calleeID, "roomId": roomID})
			refusal := receivedEvent(t, caller)
			require.Equal(t, "calls_forbidden", refusal["reason"])
			require.Equal(t, false, refusal["accepted"])
			requireNoEvent(t, callee)
			require.Empty(t, ws.pendingInvites)
			require.Empty(t, pushed.events)
			require.Equal(t, before, counts())
			var invited bool
			require.NoError(t, db.QueryRow(`SELECT invited_at IS NOT NULL FROM calls.rooms WHERE id=$1`, roomID).Scan(&invited))
			require.False(t, invited)
			for _, conn := range []*Client{caller, callee} {
				ws.handleCallJoin(conn, map[string]interface{}{"roomId": roomID})
				event := receivedEvent(t, conn)
				require.Equal(t, "call_error", event["type"])
				require.Equal(t, "room_not_found", event["reason"])
			}
			require.Nil(t, ws.callRooms.GetRoomPublic(roomID))
			require.Equal(t, before, counts())
		}
	})
	for _, phase := range []string{"replay", "accept"} {
		t.Run("policy change before "+phase, func(t *testing.T) {
			reset()
			code, out := create(callerID)
			require.Equal(t, http.StatusCreated, code)
			roomID := out["room"].(map[string]any)["id"].(string)
			ws.handleCallInvite(caller, map[string]interface{}{"to": calleeID, "roomId": roomID})
			require.Equal(t, "call_incoming", receivedEvent(t, callee)["type"])
			set(`{"calls":"nobody"}`)
			pushed.events = nil
			before := counts()
			if phase == "replay" {
				ws.deliverPendingInvite(callee)
			} else {
				ws.handleCallInviteResponse(callee, map[string]interface{}{"roomId": roomID, "accepted": true})
			}
			require.Equal(t, "calls_forbidden", receivedEvent(t, caller)["reason"])
			require.Equal(t, "call_cancelled", receivedEvent(t, callee)["type"])
			requireNoEvent(t, callee)
			require.Nil(t, ws.callRooms.GetRoomPublic(roomID))
			require.Empty(t, ws.pendingInvites)
			require.Empty(t, ws.heldAccepts)
			require.Empty(t, pushed.events)
			require.Equal(t, before, counts())
		})
	}

	t.Run("late refusal frees caller without a missed call or message", func(t *testing.T) {
		reset()
		code, out := create(callerID)
		require.Equal(t, http.StatusCreated, code)
		roomID := out["room"].(map[string]any)["id"].(string)
		ws.handleCallJoin(caller, map[string]interface{}{"roomId": roomID})
		require.Equal(t, "call_joined", receivedEvent(t, caller)["type"])
		set(`{"calls":"nobody"}`)
		before := counts()
		ws.handleCallInvite(caller, map[string]interface{}{"to": calleeID, "roomId": roomID})
		require.Equal(t, "calls_forbidden", receivedEvent(t, caller)["reason"])
		require.Nil(t, ws.callRooms.GetUserRoom(callerID))
		require.Nil(t, ws.callRooms.GetRoomPublic(roomID))
		require.False(t, ws.callRooms.IsParticipant(roomID, callerID))
		require.Empty(t, ws.pendingInvites)
		require.Empty(t, pushed.events)
		requireNoEvent(t, callee)
		require.Equal(t, before, counts())
		var ended, left bool
		require.NoError(t, db.QueryRow(`SELECT ended_at IS NOT NULL FROM calls.rooms WHERE id=$1`, roomID).Scan(&ended))
		require.NoError(t, db.QueryRow(`SELECT left_at IS NOT NULL FROM calls.participants WHERE room_id=$1 AND user_id=$2`, roomID, callerID).Scan(&left))
		require.True(t, ended)
		require.True(t, left)
		// Следующий входящий звонок больше не получает ложный busy.
		code, out = create(calleeID)
		require.Equal(t, http.StatusCreated, code)
		ws.handleCallInvite(callee, map[string]interface{}{"to": callerID, "roomId": out["room"].(map[string]any)["id"]})
		require.Equal(t, "call_incoming", receivedEvent(t, caller)["type"])
		requireNoEvent(t, callee)
	})
	t.Run("replay revocation cancels the original device too", func(t *testing.T) {
		reset()
		code, out := create(callerID)
		require.Equal(t, http.StatusCreated, code)
		roomID := out["room"].(map[string]any)["id"].(string)
		ws.handleCallInvite(caller, map[string]interface{}{"to": calleeID, "roomId": roomID})
		require.Equal(t, "call_incoming", receivedEvent(t, callee)["type"])
		set(`{"calls":"nobody"}`)
		otherDevice := connectLocal(ws, calleeID)
		defer func() {
			ws.mu.Lock()
			delete(ws.clients[calleeID], otherDevice)
			ws.mu.Unlock()
		}()
		ws.deliverPendingInvite(otherDevice)
		require.Equal(t, "calls_forbidden", receivedEvent(t, caller)["reason"])
		for _, device := range []*Client{callee, otherDevice} {
			event := receivedEvent(t, device)
			require.Equal(t, "call_cancelled", event["type"])
			require.Equal(t, roomID, event["roomId"])
			requireNoEvent(t, device)
		}
		require.Empty(t, ws.pendingInvites)
		require.Nil(t, ws.callRooms.GetRoomPublic(roomID))
	})
	t.Run("direct join denial closes the unused room", func(t *testing.T) {
		reset()
		code, out := create(callerID)
		require.Equal(t, http.StatusCreated, code)
		roomID := out["room"].(map[string]any)["id"].(string)
		set(`{"calls":"nobody"}`)
		before := counts()
		ws.handleCallJoin(caller, map[string]interface{}{"roomId": roomID})
		require.Equal(t, "calls_forbidden", receivedEvent(t, caller)["reason"])
		require.Nil(t, ws.callRooms.GetRoomPublic(roomID))
		requireNoEvent(t, callee)
		require.Equal(t, before, counts())
	})
	t.Run("denied restore stays queued until orphan cleanup", func(t *testing.T) {
		reset()
		code, out := create(callerID)
		require.Equal(t, http.StatusCreated, code)
		roomID := out["room"].(map[string]any)["id"].(string)
		for _, conn := range []*Client{caller, callee} {
			ws.handleCallJoin(conn, map[string]interface{}{"roomId": roomID})
			require.Equal(t, "call_joined", receivedEvent(t, conn)["type"])
		}
		require.Equal(t, "call_peer_joined", receivedEvent(t, caller)["type"])
		set(`{"calls":"nobody"}`)
		after := &WSServer{db: db, clients: make(map[string]map[*Client]bool), callRooms: NewCallRoomManager()}
		after.callRooms.AddRestorable(RestorableRoom{ID: roomID, ChatID: chatID, HostID: callerID, CalleeID: calleeID, CallKind: "audio", CreatedAt: time.Now().Add(-time.Minute).UnixMilli(), AnsweredAt: time.Now().Add(-time.Second).UnixMilli()})
		for _, userID := range []string{callerID, calleeID} {
			conn := connectLocal(after, userID)
			after.handleCallJoin(conn, map[string]interface{}{"roomId": roomID})
			require.Equal(t, "calls_forbidden", receivedEvent(t, conn)["reason"])
		}
		require.Nil(t, after.callRooms.GetRoomPublic(roomID))
		require.Len(t, after.callRooms.restorable, 1)
		var ended sql.NullTime
		require.NoError(t, db.QueryRow(`SELECT ended_at FROM calls.rooms WHERE id=$1`, roomID).Scan(&ended))
		require.False(t, ended.Valid)
		before := counts()
		after.closeUnrestoredCalls(time.Now())
		require.NoError(t, db.QueryRow(`SELECT ended_at FROM calls.rooms WHERE id=$1`, roomID).Scan(&ended))
		require.True(t, ended.Valid)
		require.Empty(t, after.callRooms.restorable)
		require.Eventually(t, func() bool { return counts()[2] == before[2]+1 }, time.Second, 10*time.Millisecond)
	})
	t.Run("valid patch affects calls and invalid patches cannot overwrite it", func(t *testing.T) {
		reset()
		userHandler := user.NewHandler(users, nil)
		for _, path := range []string{"/api/v2/users/privacy", "/api/v2/users/all-settings"} {
			for _, patch := range []string{`{"calls":"nobody"}`, `{"calls":null}`, `{"calls":42}`, `{"calls":"friends"}`, `{"callsFrom":"all"}`} {
				body := patch
				if strings.HasSuffix(path, "all-settings") {
					body = `{"privacySettings":` + patch + `}`
				}
				req := httptest.NewRequest(http.MethodPut, path, strings.NewReader(body))
				req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: calleeID}))
				rec := httptest.NewRecorder()
				if strings.HasSuffix(path, "all-settings") {
					userHandler.AllSettings(rec, req)
				} else {
					userHandler.Privacy(rec, req)
				}
				want := http.StatusBadRequest
				if patch == `{"calls":"nobody"}` {
					want = http.StatusOK
				}
				require.Equal(t, want, rec.Code, rec.Body.String())
				if want == http.StatusBadRequest {
					require.Contains(t, rec.Body.String(), `"validation_failed"`)
				}
				code, out := create(callerID)
				require.Equal(t, http.StatusForbidden, code)
				require.Equal(t, "calls_forbidden", out["code"])
			}
		}
	})
}
