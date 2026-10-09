//go:build integration

package chat

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// История звонков (#713): итог каждого звонка — со стороны звонящего и
// того, кого звали, — пишется на событиях сокета и отдаётся GET
// /calls/history страницами, только своим.
func TestCallHistoryOnRealSchema(t *testing.T) {
	db := dbtest.Postgres(t)
	ctx := context.Background()

	prevTTL := callInviteTTL
	callInviteTTL = 300 * time.Millisecond
	t.Cleanup(func() { callInviteTTL = prevTTL })

	ws := &WSServer{
		db: db, clients: make(map[string]map[*Client]bool),
		callRooms: NewCallRoomManager(), pendingInvites: make(map[string]*pendingInvite),
	}
	chats := NewService(db, ws, nil)

	userN := 0
	user := func(first, last string) string {
		userN++
		id := fmt.Sprintf("aaaaaaaa-4713-4713-8713-%012d", userN)
		dbtest.User(t, db, id, fmt.Sprintf("history_%d", userN))
		_, err := db.Exec(`INSERT INTO users.profiles (user_id, first_name, last_name, avatar_url)
			VALUES ($1, $2, $3, $4)`, id, first, last, "/api/v2/media/avatar-"+id)
		require.NoError(t, err)
		return id
	}
	connect := func(userID string) *Client {
		client := &Client{UserID: userID, Send: make(chan []byte, 64)}
		ws.mu.Lock()
		if ws.clients[userID] == nil {
			ws.clients[userID] = map[*Client]bool{}
		}
		ws.clients[userID][client] = true
		ws.mu.Unlock()
		return client
	}
	drain := func(clients ...*Client) {
		for _, c := range clients {
			for len(c.Send) > 0 {
				<-c.Send
			}
		}
	}
	room := func(host, peer, kind string) (string, string) {
		chatID, _, err := chats.CreatePrivate(ctx, host, peer)
		require.NoError(t, err)
		roomID, err := chats.CreateCallRoom(ctx, host, chatID, "p2p", kind, "")
		require.NoError(t, err)
		return roomID, chatID
	}
	join := func(c *Client, roomID string) {
		ws.handleCallJoin(c, map[string]interface{}{"roomId": roomID})
	}
	leave := func(c *Client, roomID string) {
		ws.handleCallLeave(c, map[string]interface{}{"roomId": roomID})
	}
	invite := func(from *Client, to, roomID string) {
		ws.handleCallInvite(from, map[string]interface{}{"type": "call_invite", "to": to, "roomId": roomID})
	}
	respond := func(c *Client, roomID string, accepted bool, reason string) {
		ws.handleCallInviteResponse(c, map[string]interface{}{"roomId": roomID, "accepted": accepted, "reason": reason})
	}
	history := func(userID string, params CallHistoryParams) CallHistoryPage {
		page, err := chats.CallHistory(ctx, userID, params)
		require.NoError(t, err)
		return page
	}
	only := func(userID string) CallHistoryItem {
		page := history(userID, CallHistoryParams{})
		require.Len(t, page.Calls, 1)
		return page.Calls[0]
	}

	t.Run("отвеченный — у обоих, с собеседником и длительностью", func(t *testing.T) {
		masha, igor := user("Мария", "Иванова"), user("Игорь", "Петров")
		mc, ic := connect(masha), connect(igor)
		roomID, chatID := room(masha, igor, "audio")

		join(mc, roomID)
		invite(mc, igor, roomID)
		respond(ic, roomID, true, "")
		join(ic, roomID)
		time.Sleep(1100 * time.Millisecond)
		leave(mc, roomID)
		leave(ic, roomID)
		drain(mc, ic)

		out := only(masha)
		require.Equal(t, roomID, out.ID)
		require.Equal(t, roomID, out.RoomID)
		require.Equal(t, chatID, *out.ChatID)
		require.Equal(t, "outgoing", out.Direction)
		require.Equal(t, "answered", out.Status)
		require.Equal(t, "audio", out.Kind)
		require.Equal(t, igor, out.PeerID)
		require.Equal(t, "Игорь Петров", out.PeerName)
		require.Equal(t, "/api/v2/media/avatar-"+igor, *out.PeerAvatar)
		require.NotNil(t, out.AnsweredAt)
		require.GreaterOrEqual(t, out.DurationSeconds, 1)
		require.False(t, out.EndedAt.Before(out.StartedAt))

		in := only(igor)
		require.Equal(t, "incoming", in.Direction)
		require.Equal(t, "answered", in.Status)
		require.Equal(t, masha, in.PeerID)
		require.Equal(t, "Мария Иванова", in.PeerName)
		require.Equal(t, out.DurationSeconds, in.DurationSeconds)

		var left int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM calls.participants WHERE room_id = $1 AND left_at IS NOT NULL`, roomID).Scan(&left))
		require.Equal(t, 2, left, "участие обоих записано и закрыто")
	})

	t.Run("отклонил — отклонённый у обоих", func(t *testing.T) {
		masha, igor := user("Мария", "Б"), user("Игорь", "Б")
		mc, ic := connect(masha), connect(igor)
		roomID, _ := room(masha, igor, "video")

		join(mc, roomID)
		invite(mc, igor, roomID)
		respond(ic, roomID, false, "")
		// Клиент звонящего на отказ call_leave не шлёт — комнату закрывает сервер.
		require.Nil(t, ws.callRooms.GetRoom(roomID))
		require.Nil(t, ws.callRooms.GetUserRoom(masha), "звонящий не остаётся «занятым»")
		drain(mc, ic)

		require.Equal(t, "rejected", only(masha).Status)
		in := only(igor)
		require.Equal(t, "rejected", in.Status)
		require.Equal(t, "video", in.Kind)
		require.Zero(t, in.DurationSeconds)
		require.Nil(t, in.AnsweredAt)
	})

	t.Run("не ответил — у звонящего отменённый, у собеседника пропущенный", func(t *testing.T) {
		masha, igor := user("Мария", "В"), user("Игорь", "В")
		mc, ic := connect(masha), connect(igor)
		roomID, _ := room(masha, igor, "audio")

		join(mc, roomID)
		invite(mc, igor, roomID)
		require.Eventually(t, func() bool {
			var reason *string
			_ = db.QueryRow(`SELECT end_reason FROM calls.rooms WHERE id = $1`, roomID).Scan(&reason)
			return reason != nil && *reason == callEndNoAnswer
		}, 3*time.Second, 20*time.Millisecond)
		require.Eventually(t, func() bool { return ws.callRooms.GetRoom(roomID) == nil }, 3*time.Second, 20*time.Millisecond)
		drain(mc, ic)

		require.Equal(t, "cancelled", only(masha).Status)
		require.Equal(t, "missed", only(igor).Status)
	})

	t.Run("звонящий положил трубку до ответа — отменённый и пропущенный", func(t *testing.T) {
		masha, igor := user("Мария", "Г"), user("Игорь", "Г")
		mc, ic := connect(masha), connect(igor)
		roomID, _ := room(masha, igor, "audio")

		join(mc, roomID)
		invite(mc, igor, roomID)
		leave(mc, roomID)
		drain(mc, ic)

		require.Equal(t, "cancelled", only(masha).Status)
		require.Equal(t, "missed", only(igor).Status)
	})

	t.Run("собеседник занят — у звонящего отклонённый, у занятого звонка нет", func(t *testing.T) {
		masha, igor, vera := user("Мария", "Д"), user("Игорь", "Д"), user("Вера", "Д")
		mc, ic, vc := connect(masha), connect(igor), connect(vera)
		busyRoom, _ := room(vera, igor, "audio")
		join(vc, busyRoom)
		join(ic, busyRoom)

		roomID, _ := room(masha, igor, "audio")
		join(mc, roomID)
		invite(mc, igor, roomID)
		require.Nil(t, ws.callRooms.GetRoom(roomID), "отказ «занят» закрывает комнату звонящего")
		drain(mc, ic, vc)

		out := only(masha)
		require.Equal(t, "rejected", out.Status)
		require.Equal(t, igor, out.PeerID)

		// У Игоря — только разговор с Верой, и тот ещё идёт: в истории пусто.
		require.Empty(t, history(igor, CallHistoryParams{}).Calls)
		leave(vc, busyRoom)
		leave(ic, busyRoom)
		drain(ic, vc)
		require.Equal(t, vera, only(igor).PeerID)
	})

	t.Run("позвать не успел — у собеседника звонка нет", func(t *testing.T) {
		masha, igor := user("Мария", "Е"), user("Игорь", "Е")
		mc := connect(masha)
		roomID, _ := room(masha, igor, "video")

		join(mc, roomID)
		leave(mc, roomID)
		drain(mc)

		out := only(masha)
		require.Equal(t, "cancelled", out.Status)
		require.Equal(t, igor, out.PeerID, "собеседник — второй участник личного чата")
		require.Empty(t, history(igor, CallHistoryParams{}).Calls)
	})

	t.Run("новый звонок из незакрытой комнаты — прежняя закрыта с итогом", func(t *testing.T) {
		masha, igor := user("Мария", "К"), user("Игорь", "К")
		mc, ic := connect(masha), connect(igor)
		first, _ := room(masha, igor, "audio")
		join(mc, first)
		invite(mc, igor, first)

		second, _ := room(masha, igor, "video")
		join(mc, second)
		require.Nil(t, ws.callRooms.GetRoom(first))
		leave(mc, second)
		drain(mc, ic)

		calls := history(masha, CallHistoryParams{}).Calls
		require.Len(t, calls, 2)
		require.Equal(t, []string{second, first}, []string{calls[0].ID, calls[1].ID})
		require.Equal(t, "missed", only(igor).Status, "в первую звали, во вторую — нет")
	})

	t.Run("постороннему — ничего; аватар — по правилу «Фото»", func(t *testing.T) {
		masha, igor, stranger := user("Мария", "Ж"), user("Игорь", "Ж"), user("Чужой", "Ж")
		mc, ic := connect(masha), connect(igor)
		roomID, _ := room(masha, igor, "audio")
		join(mc, roomID)
		invite(mc, igor, roomID)
		respond(ic, roomID, true, "")
		join(ic, roomID)
		leave(mc, roomID)
		leave(ic, roomID)
		drain(mc, ic)

		require.Empty(t, history(stranger, CallHistoryParams{}).Calls)

		_, err := db.Exec(`INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, '{"photoVisibility":"nobody"}'::jsonb)
			ON CONFLICT (user_id) DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings`, igor)
		require.NoError(t, err)
		require.Nil(t, only(masha).PeerAvatar)
		require.NotNil(t, only(igor).PeerAvatar, "своё правило Маша не меняла")
	})

	t.Run("страницы от новых к старым, без повторов; фильтры", func(t *testing.T) {
		masha, igor := user("Мария", "З"), user("Игорь", "З")
		mc, ic := connect(masha), connect(igor)
		var rooms []string
		for _, kind := range []string{"audio", "video", "audio"} {
			roomID, _ := room(masha, igor, kind)
			join(mc, roomID)
			invite(mc, igor, roomID)
			leave(mc, roomID)
			rooms = append(rooms, roomID)
		}
		drain(mc, ic)

		first := history(masha, CallHistoryParams{Limit: 2})
		require.True(t, first.HasMore)
		require.NotNil(t, first.NextCursor)
		require.Equal(t, []string{rooms[2], rooms[1]}, []string{first.Calls[0].ID, first.Calls[1].ID})

		second := history(masha, CallHistoryParams{Limit: 2, Cursor: *first.NextCursor})
		require.False(t, second.HasMore)
		require.Nil(t, second.NextCursor)
		require.Len(t, second.Calls, 1)
		require.Equal(t, rooms[0], second.Calls[0].ID)

		video := history(masha, CallHistoryParams{Kind: "video"})
		require.Len(t, video.Calls, 1)
		require.Equal(t, rooms[1], video.Calls[0].ID)

		require.Len(t, history(igor, CallHistoryParams{Status: "missed"}).Calls, 3)
		require.Empty(t, history(igor, CallHistoryParams{Status: "answered"}).Calls)
	})

	t.Run("испорченный курсор и неизвестные фильтры — ошибка запроса", func(t *testing.T) {
		masha := user("Мария", "И")
		_, err := chats.CallHistory(ctx, masha, CallHistoryParams{Cursor: "не-курсор"})
		require.ErrorIs(t, err, ErrInvalidCallCursor)
		_, err = chats.CallHistory(ctx, masha, CallHistoryParams{Cursor: encodeCallCursor(time.Now(), "не-uuid")})
		require.ErrorIs(t, err, ErrInvalidCallCursor)
		_, err = chats.CallHistory(ctx, masha, CallHistoryParams{Kind: "group"})
		require.ErrorIs(t, err, ErrInvalidInput)
		_, err = chats.CallHistory(ctx, masha, CallHistoryParams{Status: "busy"})
		require.ErrorIs(t, err, ErrInvalidInput)
	})
}
