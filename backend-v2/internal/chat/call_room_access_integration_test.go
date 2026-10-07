//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Комната звонка — только участникам её чата (#848): посторонний не видит
// её по id, не входит в неё и не может завести комнату входом.
func TestCallRoomAccessOnRealSchema(t *testing.T) {
	const (
		masha    = "aaaaaaaa-4848-4848-8848-111111111111"
		igor     = "bbbbbbbb-4848-4848-8848-222222222222"
		stranger = "cccccccc-4848-4848-8848-333333333333"
		unknown  = "dddddddd-4848-4848-8848-444444444444"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, masha, "call_masha")
	dbtest.User(t, db, igor, "call_igor")
	dbtest.User(t, db, stranger, "call_stranger")

	ws := &WSServer{db: db, clients: make(map[string]map[*Client]bool), callRooms: NewCallRoomManager()}
	chats := NewService(db, ws, nil)
	handler := NewHandler(chats)

	chatID, _, err := chats.CreatePrivate(ctx, masha, igor)
	require.NoError(t, err)
	roomID, err := chats.CreateCallRoom(ctx, masha, chatID, "p2p", "audio", "")
	require.NoError(t, err)

	getRoom := func(user string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/v2/calls/rooms/"+roomID, nil)
		req.SetPathValue("id", roomID)
		req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: user}))
		rec := httptest.NewRecorder()
		handler.GetRoom(rec, req)
		return rec.Code
	}
	// Подключение, как у настоящего сокета: сервер находит его по пользователю.
	connect := func(user string) *Client {
		client := &Client{UserID: user, Send: make(chan []byte, 8)}
		ws.mu.Lock()
		ws.clients[user] = map[*Client]bool{client: true}
		ws.mu.Unlock()
		return client
	}
	next := func(t *testing.T, c *Client) map[string]any {
		t.Helper()
		require.NotEmpty(t, c.Send, "ждали сообщение для %s", c.UserID)
		var event map[string]any
		require.NoError(t, json.Unmarshal(<-c.Send, &event))
		return event
	}
	join := func(c *Client, room string) {
		ws.handleCallJoin(c, map[string]interface{}{"roomId": room, "chatId": chatID, "callKind": "audio"})
	}

	t.Run("комната по id — только участнику чата", func(t *testing.T) {
		require.Equal(t, http.StatusOK, getRoom(igor))
		require.Equal(t, http.StatusNotFound, getRoom(stranger))
	})

	mashaConn := connect(masha)
	join(mashaConn, roomID)
	require.Equal(t, "call_joined", next(t, mashaConn)["type"])

	t.Run("посторонний не входит и о нём не сообщают", func(t *testing.T) {
		strangerConn := connect(stranger)
		join(strangerConn, roomID)

		event := next(t, strangerConn)
		require.Equal(t, "call_error", event["type"])
		require.Equal(t, "room_not_found", event["reason"])
		require.Empty(t, strangerConn.CallRoomID)
		require.Empty(t, mashaConn.Send, "участник не должен узнать о постороннем")
		require.Len(t, ws.callRooms.GetRoomPublic(roomID).Participants, 1)
	})

	t.Run("несуществующая комната не создаётся входом", func(t *testing.T) {
		strangerConn := connect(stranger)
		join(strangerConn, unknown)

		event := next(t, strangerConn)
		require.Equal(t, "call_error", event["type"])
		require.Equal(t, "room_not_found", event["reason"])
		require.Nil(t, ws.callRooms.GetRoom(unknown))
	})

	t.Run("собеседник входит как раньше", func(t *testing.T) {
		igorConn := connect(igor)
		join(igorConn, roomID)

		require.Equal(t, "call_joined", next(t, igorConn)["type"])
		require.Equal(t, roomID, igorConn.CallRoomID)
		require.Equal(t, "call_peer_joined", next(t, mashaConn)["type"])
	})
}
