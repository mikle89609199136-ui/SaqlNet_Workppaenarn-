//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Звонки в MVP — только один на один (#715): комната — только в личном
// чате и не больше чем на двоих, что бы ни прислал клиент.
func TestCallRoomOneToOneOnRealSchema(t *testing.T) {
	const (
		anna  = "aaaaaaaa-4715-4715-8715-111111111111"
		boris = "bbbbbbbb-4715-4715-8715-222222222222"
		vera  = "cccccccc-4715-4715-8715-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, anna, "one_anna")
	dbtest.User(t, db, boris, "one_boris")
	dbtest.User(t, db, vera, "one_vera")

	ws := &WSServer{db: db, clients: make(map[string]map[*Client]bool), callRooms: NewCallRoomManager()}
	chats := NewService(db, ws, nil)
	handler := NewHandler(chats)

	private, _, err := chats.CreatePrivate(ctx, anna, boris)
	require.NoError(t, err)
	group, err := chats.CreateGroup(ctx, anna, "Группа", "", "", []string{boris, vera})
	require.NoError(t, err)
	channel, err := chats.CreateGroup(ctx, anna, "Канал", "", "", []string{boris})
	require.NoError(t, err)
	_, err = db.Exec(`UPDATE chats.chats SET type = 'channel' WHERE id = $1`, channel)
	require.NoError(t, err)

	createRoom := func(user, chatID, roomType string) (int, map[string]any) {
		body := `{"type":"` + roomType + `","chatId":"` + chatID + `","callKind":"audio"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v2/calls/rooms", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: user}))
		rec := httptest.NewRecorder()
		handler.CallRoom(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	roomsInChat := func(chatID string) int {
		var n int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM calls.rooms WHERE chat_id = $1`, chatID).Scan(&n))
		return n
	}
	connect := func(user string) *Client {
		client := &Client{UserID: user, Send: make(chan []byte, 8)}
		ws.mu.Lock()
		ws.clients[user] = map[*Client]bool{client: true}
		ws.mu.Unlock()
		return client
	}
	lastEvent := func(t *testing.T, c *Client) map[string]any {
		t.Helper()
		var event map[string]any
		for len(c.Send) > 0 {
			require.NoError(t, json.Unmarshal(<-c.Send, &event))
		}
		return event
	}

	t.Run("в группе и в канале — 400 group_calls_unavailable, комнаты нет", func(t *testing.T) {
		for _, chatID := range []string{group, channel} {
			code, out := createRoom(anna, chatID, "group")
			require.Equal(t, http.StatusBadRequest, code)
			require.Equal(t, "group_calls_unavailable", out["code"])
			require.Zero(t, roomsInChat(chatID))
		}
		ws.callRooms.mu.Lock()
		require.Empty(t, ws.callRooms.rooms)
		ws.callRooms.mu.Unlock()
	})

	t.Run("в личном чате — как раньше, тип p2p, даже если прислали group", func(t *testing.T) {
		code, out := createRoom(anna, private, "group")
		require.Equal(t, http.StatusCreated, code)
		room := out["room"].(map[string]any)
		require.Equal(t, "p2p", room["type"])
		require.EqualValues(t, 2, out["maxParticipants"])
		require.Equal(t, "p2p", ws.callRooms.GetRoom(room["id"].(string)).roomType)
	})

	t.Run("неверный chatId — 400, а не 500", func(t *testing.T) {
		for _, chatID := range []string{"", "not-a-uuid"} {
			code, out := createRoom(anna, chatID, "p2p")
			require.Equal(t, http.StatusBadRequest, code)
			require.Equal(t, "validation_failed", out["code"])
		}
	})

	t.Run("третьего в комнату не пускает", func(t *testing.T) {
		// Комната с тремя участниками чата в обход API — проверка лимита
		// не должна зависеть от того, как комната появилась.
		ws.callRooms.CreateRoom(anna, "room-715", "p2p", "audio", group, "")
		for _, user := range []string{anna, boris} {
			conn := connect(user)
			ws.handleCallJoin(conn, map[string]interface{}{"roomId": "room-715"})
			require.Equal(t, "call_joined", lastEvent(t, conn)["type"])
		}
		third := connect(vera)
		ws.handleCallJoin(third, map[string]interface{}{"roomId": "room-715"})
		event := lastEvent(t, third)
		require.Equal(t, "call_error", event["type"])
		require.Equal(t, "room_full", event["reason"])
		require.Len(t, ws.callRooms.GetRoomPublic("room-715").Participants, 2)
	})
}
