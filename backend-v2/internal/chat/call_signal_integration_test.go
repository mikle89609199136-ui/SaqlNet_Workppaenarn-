//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Сигналы соединения звонка — только между участниками одной комнаты и
// только в их подключения в этой комнате (#849).
func TestCallSignalOnRealSchema(t *testing.T) {
	const (
		masha    = "aaaaaaaa-4849-4849-8849-111111111111"
		igor     = "bbbbbbbb-4849-4849-8849-222222222222"
		stranger = "cccccccc-4849-4849-8849-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, masha, "signal_masha")
	dbtest.User(t, db, igor, "signal_igor")
	dbtest.User(t, db, stranger, "signal_stranger")

	ws := &WSServer{db: db, clients: make(map[string]map[*Client]bool), callRooms: NewCallRoomManager()}
	chats := NewService(db, ws, nil)

	// Подключения как у настоящего сокета: у человека их может быть несколько.
	connect := func(user string) *Client {
		client := &Client{UserID: user, Send: make(chan []byte, 128)}
		ws.mu.Lock()
		if ws.clients[user] == nil {
			ws.clients[user] = map[*Client]bool{}
		}
		ws.clients[user][client] = true
		ws.mu.Unlock()
		return client
	}
	room := func(a, b string) string {
		chatID, _, err := chats.CreatePrivate(ctx, a, b)
		require.NoError(t, err)
		roomID, err := chats.CreateCallRoom(ctx, a, chatID, "p2p", "audio", "")
		require.NoError(t, err)
		return roomID
	}
	join := func(c *Client, roomID string) {
		ws.handleCallJoin(c, map[string]interface{}{"roomId": roomID})
		for len(c.Send) > 0 {
			<-c.Send // call_joined / call_peer_joined
		}
	}
	signal := func(from *Client, msgType, to, roomID string, payload any) {
		ws.relayCallSignal(from, msgType, map[string]interface{}{
			"type": msgType, "to": to, "roomId": roomID, "payload": payload,
		})
	}
	drain := func(c *Client) []map[string]any {
		var got []map[string]any
		for len(c.Send) > 0 {
			var event map[string]any
			require.NoError(t, json.Unmarshal(<-c.Send, &event))
			got = append(got, event)
		}
		return got
	}
	offer := map[string]any{"type": "offer", "sdp": "v=0"}

	callRoom := room(masha, igor)
	otherRoom := room(stranger, masha)

	mashaCall := connect(masha)
	igorCall := connect(igor)
	igorOtherTab := connect(igor)
	strangerConn := connect(stranger)
	join(mashaCall, callRoom)
	join(igorCall, callRoom)
	drain(mashaCall) // о входе Игоря

	t.Run("между участниками комнаты — доходит, и только в подключение в комнате", func(t *testing.T) {
		signal(mashaCall, "call_offer", igor, callRoom, offer)

		got := drain(igorCall)
		require.Len(t, got, 1)
		require.Equal(t, "call_offer", got[0]["type"])
		require.Equal(t, masha, got[0]["from"])
		require.Equal(t, callRoom, got[0]["roomId"])
		require.Equal(t, offer, got[0]["payload"])
		require.Empty(t, drain(igorOtherTab), "вторая вкладка не в звонке")
	})

	t.Run("не из комнаты, чужой roomId, не участнику — не доходит", func(t *testing.T) {
		signal(strangerConn, "call_ice", igor, callRoom, offer) // посторонний без комнаты
		signal(mashaCall, "call_offer", igor, otherRoom, offer) // чужой roomId
		signal(mashaCall, "call_offer", igor, "", offer)        // без roomId
		signal(mashaCall, "call_offer", stranger, callRoom, offer)
		signal(igorOtherTab, "call_answer", masha, callRoom, offer) // вкладка не в звонке

		require.Empty(t, drain(igorCall))
		require.Empty(t, drain(igorOtherTab))
		require.Empty(t, drain(strangerConn))
		require.Empty(t, drain(mashaCall))
	})

	t.Run("из другой комнаты собеседнику не доходит", func(t *testing.T) {
		strangerCall := connect(stranger)
		join(strangerCall, otherRoom)
		signal(strangerCall, "call_offer", masha, otherRoom, offer)
		require.Empty(t, drain(mashaCall), "Маша в другой комнате")
	})

	t.Run("слишком большой payload отбрасывается", func(t *testing.T) {
		signal(mashaCall, "call_offer", igor, callRoom, map[string]any{"sdp": strings.Repeat("a", 70<<10)})
		require.Empty(t, drain(igorCall))
	})

	t.Run("сверх частоты — отбрасывается", func(t *testing.T) {
		busy := connect(masha)
		join(busy, callRoom)
		drain(igorCall) // о входе второго подключения
		for i := 0; i < maxCallSignalsPerSecond+20; i++ {
			signal(busy, "call_ice", igor, callRoom, map[string]any{"candidate": "c"})
		}
		require.Len(t, drain(igorCall), maxCallSignalsPerSecond)
	})
}
