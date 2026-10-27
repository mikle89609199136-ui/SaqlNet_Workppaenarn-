//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Собеседник вышел из звонка — сам («Завершить», call_leave) или у него
// оборвался сокет. Клиенту это разные вещи: в первом случае звонок
// закончен, во втором его восстанавливают (#775).
func TestCallPeerLeftReasonOnRealSchema(t *testing.T) {
	const (
		masha = "aaaaaaaa-4775-4775-8775-111111111111"
		igor  = "bbbbbbbb-4775-4775-8775-222222222222"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, masha, "left_masha")
	dbtest.User(t, db, igor, "left_igor")

	ws := &WSServer{
		db: db, clients: make(map[string]map[*Client]bool),
		callRooms: NewCallRoomManager(), pendingInvites: make(map[string]*pendingInvite),
	}
	chats := NewService(db, ws, nil)
	chatID, _, err := chats.CreatePrivate(ctx, masha, igor)
	require.NoError(t, err)
	t.Cleanup(func() {
		// callRoomClosed сохраняет сообщение асинхронно: дождаться до закрытия БД.
		require.Eventually(t, func() bool {
			var rooms, messages int
			err := db.QueryRow(`SELECT
				(SELECT COUNT(*) FROM calls.rooms WHERE chat_id = $1),
				(SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1 AND type = 'call')`, chatID).Scan(&rooms, &messages)
			return err == nil && rooms == messages
		}, 3*time.Second, 10*time.Millisecond)
	})

	connect := func(user string) *Client {
		client := &Client{UserID: user, Send: make(chan []byte, 16)}
		ws.mu.Lock()
		ws.clients[user] = map[*Client]bool{client: true}
		ws.mu.Unlock()
		return client
	}
	callBetween := func(t *testing.T) (roomID string, mashaConn, igorConn *Client) {
		t.Helper()
		roomID, err := chats.CreateCallRoom(ctx, masha, chatID, "p2p", "audio", "")
		require.NoError(t, err)
		mashaConn, igorConn = connect(masha), connect(igor)
		for _, c := range []*Client{mashaConn, igorConn} {
			ws.handleCallJoin(c, map[string]interface{}{"roomId": roomID})
		}
		for len(mashaConn.Send) > 0 {
			<-mashaConn.Send
		}
		return roomID, mashaConn, igorConn
	}
	peerLeft := func(t *testing.T, c *Client) map[string]any {
		t.Helper()
		for len(c.Send) > 0 {
			var event map[string]any
			require.NoError(t, json.Unmarshal(<-c.Send, &event))
			if event["type"] == "call_peer_left" {
				return event
			}
		}
		t.Fatal("call_peer_left не пришёл")
		return nil
	}

	t.Run("«Завершить» — reason left", func(t *testing.T) {
		roomID, mashaConn, igorConn := callBetween(t)
		ws.handleCallLeave(igorConn, map[string]interface{}{"roomId": roomID})

		event := peerLeft(t, mashaConn)
		require.Equal(t, "left", event["reason"])
		require.Equal(t, igor, event["peer"].(map[string]any)["userId"])
		ws.handleCallLeave(mashaConn, map[string]interface{}{"roomId": roomID})
	})

	t.Run("оборвался сокет — reason disconnected", func(t *testing.T) {
		roomID, mashaConn, igorConn := callBetween(t)
		ws.handleCallDisconnect(igorConn)

		event := peerLeft(t, mashaConn)
		require.Equal(t, "disconnected", event["reason"])
		require.NotNil(t, ws.callRooms.GetRoomPublic(roomID))
		returned := connect(igor)
		ws.handleCallJoin(returned, map[string]interface{}{"roomId": roomID})
		require.Equal(t, roomID, returned.CallRoomID)
		require.True(t, ws.callRooms.IsParticipant(roomID, masha))
		require.True(t, ws.callRooms.IsParticipant(roomID, igor))
		var joined map[string]any
		require.NoError(t, json.Unmarshal(<-returned.Send, &joined))
		require.Equal(t, "call_joined", joined["type"])
		require.Len(t, joined["peers"], 1)
		ws.handleCallLeave(returned, map[string]interface{}{"roomId": roomID})
		ws.handleCallLeave(mashaConn, map[string]interface{}{"roomId": roomID})
	})

	t.Run("оба сокета оборвались — комната ждёт и восстанавливается", func(t *testing.T) {
		roomID, mashaConn, igorConn := callBetween(t)
		ws.handleCallDisconnect(igorConn)
		ws.handleCallDisconnect(mashaConn)
		room := ws.callRooms.GetRoomPublic(roomID)
		require.NotNil(t, room)
		require.Empty(t, room.Participants)
		mashaConn, igorConn = connect(masha), connect(igor)
		ws.handleCallJoin(mashaConn, map[string]interface{}{"roomId": roomID})
		ws.handleCallJoin(igorConn, map[string]interface{}{"roomId": roomID})
		require.Len(t, ws.callRooms.GetRoomPublic(roomID).Participants, 2)
		var endedAt *time.Time
		require.NoError(t, db.QueryRow(`SELECT ended_at FROM calls.rooms WHERE id = $1`, roomID).Scan(&endedAt))
		require.Nil(t, endedAt)
		ws.handleCallLeave(igorConn, map[string]interface{}{"roomId": roomID})
		ws.handleCallLeave(mashaConn, map[string]interface{}{"roomId": roomID})
	})

	t.Run("без полного восстановления комната закрывается по таймауту", func(t *testing.T) {
		ws.disconnectGrace = 500 * time.Millisecond
		defer func() { ws.disconnectGrace = 0 }()
		for _, scenario := range []string{"один отключился", "оба отключились", "вернулся только один"} {
			t.Run(scenario, func(t *testing.T) {
				roomID, mashaConn, igorConn := callBetween(t)
				ws.handleCallDisconnect(igorConn)
				peerLeft(t, mashaConn)
				if scenario != "один отключился" {
					ws.handleCallDisconnect(mashaConn)
				}
				if scenario == "вернулся только один" {
					ws.handleCallJoin(connect(masha), map[string]interface{}{"roomId": roomID})
				}
				require.NotNil(t, ws.callRooms.GetRoomPublic(roomID))
				require.Eventually(t, func() bool {
					var endedAt *time.Time
					err := db.QueryRow(`SELECT ended_at FROM calls.rooms WHERE id = $1`, roomID).Scan(&endedAt)
					return err == nil && endedAt != nil
				}, 3*time.Second, 10*time.Millisecond)
				require.Nil(t, ws.callRooms.GetRoomPublic(roomID))
				require.Nil(t, ws.callRooms.GetUserRoom(masha))
				require.Nil(t, ws.callRooms.GetUserRoom(igor))
				late := connect(igor)
				ws.handleCallJoin(late, map[string]interface{}{"roomId": roomID})
				require.Empty(t, late.CallRoomID)
				var event map[string]any
				require.NoError(t, json.Unmarshal(<-late.Send, &event))
				require.Equal(t, "call_error", event["type"])
				require.Equal(t, "room_not_found", event["reason"])
			})
		}
	})

	t.Run("вышел не участник — собеседнику ничего, звонок идёт", func(t *testing.T) {
		// Только события звонка: запись о прошлом звонке (new_message)
		// приходит асинхронно.
		noPeerLeft := func(c *Client) {
			for len(c.Send) > 0 {
				var event map[string]any
				require.NoError(t, json.Unmarshal(<-c.Send, &event))
				require.NotEqual(t, "call_peer_left", event["type"])
			}
		}
		roomID, mashaConn, igorConn := callBetween(t)
		// Вторая вкладка Игоря, не входившая в звонок (например, после
		// перезагрузки), и повторный выход уже вышедшего.
		ws.handleCallLeave(connect(igor), map[string]interface{}{"roomId": roomID})
		noPeerLeft(mashaConn)
		require.True(t, ws.callRooms.IsParticipant(roomID, igor))

		ws.handleCallLeave(igorConn, map[string]interface{}{"roomId": roomID})
		peerLeft(t, mashaConn)
		ws.handleCallLeave(igorConn, map[string]interface{}{"roomId": roomID})
		noPeerLeft(mashaConn)
		ws.handleCallLeave(mashaConn, map[string]interface{}{"roomId": roomID})
	})
}
