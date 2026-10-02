//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Приглашение на звонок (#850): данные звонящего — с сервера, приглашать
// можно только собеседника в свою комнату, приглашение истекает и
// отменяется, «занят» — только собеседнику, ответ — только от приглашённого.
func TestCallInviteOnRealSchema(t *testing.T) {
	const (
		masha    = "aaaaaaaa-4850-4850-8850-111111111111"
		igor     = "bbbbbbbb-4850-4850-8850-222222222222"
		stranger = "cccccccc-4850-4850-8850-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, masha, "invite_masha")
	dbtest.User(t, db, igor, "invite_igor")
	dbtest.User(t, db, stranger, "invite_stranger")
	_, err := db.Exec(`INSERT INTO users.profiles (user_id, first_name, last_name, avatar_url)
	VALUES ($1, 'Мария', 'Иванова', '/api/v2/media/masha-avatar')
	ON CONFLICT (user_id) DO UPDATE
	SET first_name = EXCLUDED.first_name,
	    last_name  = EXCLUDED.last_name,
	    avatar_url = EXCLUDED.avatar_url`, masha)
	require.NoError(t, err)

	prevTTL := callInviteTTL
	callInviteTTL = 300 * time.Millisecond
	t.Cleanup(func() { callInviteTTL = prevTTL })

	ws := &WSServer{
		db: db, clients: make(map[string]map[*Client]bool),
		callRooms: NewCallRoomManager(), pendingInvites: make(map[string]*pendingInvite),
	}
	chats := NewService(db, ws, nil)

	connect := func(user string) *Client {
		client := &Client{UserID: user, Send: make(chan []byte, 32)}
		ws.mu.Lock()
		if ws.clients[user] == nil {
			ws.clients[user] = map[*Client]bool{}
		}
		ws.clients[user][client] = true
		ws.mu.Unlock()
		return client
	}
	// Только события звонка: закрытая комната пишет в чат «пропущенный
	// звонок» (new_message) асинхронно, и он приходит когда придётся.
	drain := func(c *Client) []map[string]any {
		var got []map[string]any
		for len(c.Send) > 0 {
			var event map[string]any
			require.NoError(t, json.Unmarshal(<-c.Send, &event))
			if kind, _ := event["type"].(string); strings.HasPrefix(kind, "call_") {
				got = append(got, event)
			}
		}
		return got
	}
	types := func(events []map[string]any) []string {
		out := []string{}
		for _, e := range events {
			out = append(out, e["type"].(string))
		}
		return out
	}
	room := func(host, peer, kind string) string {
		chatID, _, err := chats.CreatePrivate(ctx, host, peer)
		require.NoError(t, err)
		roomID, err := chats.CreateCallRoom(ctx, host, chatID, "p2p", kind, "")
		require.NoError(t, err)
		return roomID
	}
	invite := func(from *Client, to, roomID string, extra map[string]interface{}) {
		msg := map[string]interface{}{"type": "call_invite", "to": to, "roomId": roomID}
		for k, v := range extra {
			msg[k] = v
		}
		ws.handleCallInvite(from, msg)
	}

	mashaConn := connect(masha)
	igorConn := connect(igor)
	strangerConn := connect(stranger)

	t.Run("данные звонящего — с сервера, подмена не доходит", func(t *testing.T) {
		roomID := room(masha, igor, "video")
		invite(mashaConn, igor, roomID, map[string]interface{}{
			"fromName": "Служба безопасности банка", "fromAvatar": "https://evil.example/a.png",
			"kind": "audio", "callType": "group", "title": "Срочно",
		})

		got := drain(igorConn)
		require.Len(t, got, 1)
		require.Equal(t, "call_incoming", got[0]["type"])
		require.Equal(t, masha, got[0]["from"])
		require.Equal(t, "Мария Иванова", got[0]["fromName"])
		require.Equal(t, "/api/v2/media/masha-avatar", got[0]["fromAvatar"])
		require.Equal(t, "video", got[0]["kind"])
		require.Equal(t, "p2p", got[0]["callType"])
		require.Empty(t, got[0]["title"])
		ws.handleCallInviteResponse(igorConn, map[string]interface{}{"roomId": roomID, "accepted": false})
		drain(mashaConn)
	})

	t.Run("в чужую комнату и не собеседнику — не доходит, звонящему ничего", func(t *testing.T) {
		mashasRoom := room(masha, igor, "audio")
		invite(strangerConn, igor, mashasRoom, nil) // чужая комната

		strangersRoom := room(stranger, masha, "audio")
		invite(strangerConn, igor, strangersRoom, nil) // Игорь не в этом чате

		require.Empty(t, drain(igorConn))
		require.Empty(t, drain(strangerConn))
	})

	t.Run("без ответа 60 с (в тесте короче) — отмена, пустая комната закрыта, повторно не звонит", func(t *testing.T) {
		roomID := room(masha, igor, "audio")
		invite(mashaConn, igor, roomID, nil)
		require.Equal(t, []string{"call_incoming"}, types(drain(igorConn)))

		require.Eventually(t, func() bool { return len(igorConn.Send) > 0 }, 3*time.Second, 20*time.Millisecond)
		require.Equal(t, []string{"call_cancelled"}, types(drain(igorConn)))
		require.Nil(t, ws.callRooms.GetRoom(roomID))

		again := connect(igor)
		ws.deliverPendingInvite(again)
		require.Empty(t, drain(again))
	})

	t.Run("звонящий отключился до ответа — отмена, повторно не звонит", func(t *testing.T) {
		callerTab := connect(masha)
		roomID := room(masha, igor, "audio")
		invite(callerTab, igor, roomID, nil)
		require.Equal(t, []string{"call_incoming"}, types(drain(igorConn)))

		ws.handleCallDisconnect(callerTab)
		require.Equal(t, []string{"call_cancelled"}, types(drain(igorConn)))
		require.Nil(t, ws.callRooms.GetRoom(roomID))

		again := connect(igor)
		ws.deliverPendingInvite(again)
		require.Empty(t, drain(again))
	})

	t.Run("«занят» — собеседнику, постороннему ничего", func(t *testing.T) {
		busyRoom := room(igor, masha, "audio")
		ws.handleCallJoin(igorConn, map[string]interface{}{"roomId": busyRoom})
		drain(igorConn)

		strangersRoom := room(stranger, masha, "audio")
		invite(strangerConn, igor, strangersRoom, nil)
		require.Empty(t, drain(strangerConn), "постороннему не раскрываем")

		mashasRoom := room(masha, igor, "audio")
		invite(mashaConn, igor, mashasRoom, nil)
		got := drain(mashaConn)
		require.Len(t, got, 1)
		require.Equal(t, "call_invite_response", got[0]["type"])
		require.Equal(t, "busy", got[0]["reason"])

		ws.handleCallLeave(igorConn, map[string]interface{}{"roomId": busyRoom})
		drain(igorConn)
		drain(mashaConn)
	})

	t.Run("ответ — только от приглашённого и только звонящему", func(t *testing.T) {
		roomID := room(masha, igor, "audio")
		invite(mashaConn, igor, roomID, nil)
		drain(igorConn)

		ws.handleCallInviteResponse(strangerConn, map[string]interface{}{"to": masha, "roomId": roomID, "accepted": false})
		require.Empty(t, drain(mashaConn))

		ws.handleCallInviteResponse(igorConn, map[string]interface{}{"to": stranger, "roomId": roomID, "accepted": true})
		got := drain(mashaConn)
		require.Len(t, got, 1)
		require.Equal(t, "call_invite_response", got[0]["type"])
		require.Equal(t, igor, got[0]["from"])
		require.Equal(t, true, got[0]["accepted"])
		require.Empty(t, drain(strangerConn))
	})
}
