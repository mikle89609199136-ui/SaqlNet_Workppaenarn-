//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"testing"

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
		ws.handleCallLeave(mashaConn, map[string]interface{}{"roomId": roomID})
	})
}
