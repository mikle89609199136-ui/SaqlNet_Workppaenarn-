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

// Комната звонка и блокировка (#912): заблокированный собеседником не
// создаёт комнату в их личном чате — ни в базе, ни в памяти. Направление —
// как у сообщений: заблокировавший звонить может.
func TestCallRoomBlockedOnRealSchema(t *testing.T) {
	const (
		blocker = "aaaaaaaa-4912-4912-8912-111111111111"
		blocked = "bbbbbbbb-4912-4912-8912-222222222222"
		third   = "cccccccc-4912-4912-8912-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, blocker, "room_blocker")
	dbtest.User(t, db, blocked, "room_blocked")
	dbtest.User(t, db, third, "room_third")

	ws := &WSServer{db: db, clients: make(map[string]map[*Client]bool), callRooms: NewCallRoomManager()}
	chats := NewService(db, ws, nil)
	handler := NewHandler(chats)

	private, _, err := chats.CreatePrivate(ctx, blocker, blocked)
	require.NoError(t, err)
	group, err := chats.CreateGroup(ctx, blocker, "Звонок", "", "", []string{blocked, third})
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, blocker, blocked)
	require.NoError(t, err)

	createRoom := func(user, chatID string) (int, map[string]any) {
		body := `{"type":"p2p","chatId":"` + chatID + `","callKind":"audio"}`
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

	t.Run("заблокированный собеседником — 403, комнаты нет ни в базе, ни в памяти", func(t *testing.T) {
		code, out := createRoom(blocked, private)
		require.Equal(t, http.StatusForbidden, code)
		require.Equal(t, "blocked_by_user", out["code"])
		require.Zero(t, roomsInChat(private))
		ws.callRooms.mu.Lock()
		require.Empty(t, ws.callRooms.rooms)
		ws.callRooms.mu.Unlock()
	})

	t.Run("заблокировавший создаёт комнату как раньше", func(t *testing.T) {
		code, out := createRoom(blocker, private)
		require.Equal(t, http.StatusCreated, code)
		roomID := out["room"].(map[string]any)["id"].(string)
		require.NotNil(t, ws.callRooms.GetRoom(roomID))
		require.Equal(t, 1, roomsInChat(private))
	})

	t.Run("в группе блокировка между двумя не мешает", func(t *testing.T) {
		code, _ := createRoom(blocked, group)
		require.Equal(t, http.StatusCreated, code)
		code, _ = createRoom(third, group)
		require.Equal(t, http.StatusCreated, code)
	})
}
