//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Звонки после рестарта сервера (#713): отвеченный поднимается входом
// участника и продолжается с прежним временем ответа; неотвеченный и
// невосстановленный закрываются с окончанием в момент рестарта; давние и
// незнакомые серверу комнаты не трогаются.
func TestCallRestoreAfterRestartOnRealSchema(t *testing.T) {
	db := dbtest.Postgres(t)
	ctx := context.Background()

	prevGrace := callRestoreGrace
	callRestoreGrace = 500 * time.Millisecond
	t.Cleanup(func() { callRestoreGrace = prevGrace })

	newServer := func() *WSServer {
		return &WSServer{
			db: db, clients: make(map[string]map[*Client]bool),
			callRooms: NewCallRoomManager(), pendingInvites: make(map[string]*pendingInvite),
		}
	}
	before := newServer()
	chats := NewService(db, before, nil)

	userN := 0
	user := func() string {
		userN++
		id := fmt.Sprintf("bbbbbbbb-4713-4713-8713-%012d", userN)
		dbtest.User(t, db, id, fmt.Sprintf("restore_%d", userN))
		return id
	}
	connect := func(ws *WSServer, userID string) *Client {
		client := &Client{UserID: userID, Send: make(chan []byte, 64)}
		ws.mu.Lock()
		if ws.clients[userID] == nil {
			ws.clients[userID] = map[*Client]bool{}
		}
		ws.clients[userID][client] = true
		ws.mu.Unlock()
		return client
	}
	events := func(c *Client) []string {
		var got []string
		for len(c.Send) > 0 {
			var event map[string]any
			require.NoError(t, json.Unmarshal(<-c.Send, &event))
			kind, _ := event["type"].(string)
			if reason, ok := event["reason"].(string); ok {
				kind += ":" + reason
			}
			got = append(got, kind)
		}
		return got
	}
	room := func(host, peer string) string {
		chatID, _, err := chats.CreatePrivate(ctx, host, peer)
		require.NoError(t, err)
		roomID, err := chats.CreateCallRoom(ctx, host, chatID, "p2p", "audio", "")
		require.NoError(t, err)
		return roomID
	}
	join := func(ws *WSServer, c *Client, roomID string) {
		ws.handleCallJoin(c, map[string]interface{}{"roomId": roomID})
	}
	leave := func(ws *WSServer, c *Client, roomID string) {
		ws.handleCallLeave(c, map[string]interface{}{"roomId": roomID})
	}
	talking := func(host, peer string) string {
		roomID := room(host, peer)
		hc, pc := connect(before, host), connect(before, peer)
		join(before, hc, roomID)
		before.handleCallInvite(hc, map[string]interface{}{"to": peer, "roomId": roomID})
		before.handleCallInviteResponse(pc, map[string]interface{}{"roomId": roomID, "accepted": true})
		join(before, pc, roomID)
		return roomID
	}
	type roomRow struct {
		answeredAt, endedAt *time.Time
		reason              *string
	}
	row := func(roomID string) roomRow {
		var r roomRow
		require.NoError(t, db.QueryRow(`SELECT answered_at, ended_at, end_reason FROM calls.rooms WHERE id = $1`, roomID).
			Scan(&r.answeredAt, &r.endedAt, &r.reason))
		return r
	}

	// До рестарта: два разговора, один звонок ещё звонит, плюс давняя и
	// незнакомая серверу (до #713, без участников) незакрытые комнаты.
	// У каждой комнаты свои люди: вход в новую комнату выводит из прежней.
	masha, igor, vera, oleg, stranger := user(), user(), user(), user(), user()
	anna, boris, kirill, lena := user(), user(), user(), user()
	resumed := talking(masha, igor)
	abandoned := talking(vera, oleg)

	ringing := room(anna, boris)
	ac := connect(before, anna)
	join(before, ac, ringing)
	before.handleCallInvite(ac, map[string]interface{}{"to": boris, "roomId": ringing})

	ancient := room(kirill, lena)
	join(before, connect(before, kirill), ancient)
	_, err := db.Exec(`UPDATE calls.rooms SET created_at = NOW() - INTERVAL '7 hours' WHERE id = $1`, ancient)
	require.NoError(t, err)
	legacy := room(lena, anna) // в комнату не входили: участников нет

	time.Sleep(1100 * time.Millisecond) // разговор длится хотя бы секунду

	// Рестарт: новый процесс, память пуста.
	after := newServer()
	restartedAt := time.Now()
	require.NoError(t, after.RecoverCallRooms(ctx))

	t.Run("неотвеченный закрыт сразу, окончание — момент рестарта", func(t *testing.T) {
		r := row(ringing)
		require.NotNil(t, r.endedAt)
		require.WithinDuration(t, restartedAt, *r.endedAt, time.Second)
		require.Equal(t, callEndCancelled, *r.reason)
		page, err := chats.CallHistory(ctx, boris, CallHistoryParams{Status: "missed"})
		require.NoError(t, err)
		require.Len(t, page.Calls, 1)
		require.Equal(t, ringing, page.Calls[0].ID)
	})

	t.Run("давние и незнакомые серверу комнаты не трогаются", func(t *testing.T) {
		require.Nil(t, row(ancient).endedAt)
		require.Nil(t, row(legacy).endedAt)
	})

	t.Run("посторонний оборванный звонок не поднимает", func(t *testing.T) {
		sc := connect(after, stranger)
		join(after, sc, resumed)
		require.Equal(t, []string{"call_error:room_not_found"}, events(sc))
		require.Nil(t, after.callRooms.GetRoom(resumed))
	})

	t.Run("участники вернулись — звонок продолжается с прежним временем ответа", func(t *testing.T) {
		answeredBefore := row(resumed).answeredAt
		require.NotNil(t, answeredBefore)

		mc2, ic2 := connect(after, masha), connect(after, igor)
		join(after, mc2, resumed)
		require.Equal(t, []string{"call_joined"}, events(mc2))
		join(after, ic2, resumed)
		require.Equal(t, []string{"call_joined"}, events(ic2))
		require.Equal(t, []string{"call_peer_joined"}, events(mc2))

		leave(after, mc2, resumed)
		leave(after, ic2, resumed)
		r := row(resumed)
		require.NotNil(t, r.endedAt)
		require.Equal(t, callEndAnswered, *r.reason)
		require.True(t, answeredBefore.Equal(*r.answeredAt), "время ответа — из базы, не со второго входа")

		page, err := chats.CallHistory(ctx, masha, CallHistoryParams{Status: "answered"})
		require.NoError(t, err)
		require.Len(t, page.Calls, 1)
		require.GreaterOrEqual(t, page.Calls[0].DurationSeconds, 1)
	})

	t.Run("никто не вернулся — закрыт по истечении ожидания, окончание — момент рестарта", func(t *testing.T) {
		require.Nil(t, row(abandoned).endedAt, "пока ждём участников, звонок не закрыт")
		require.Eventually(t, func() bool { return row(abandoned).endedAt != nil }, 3*time.Second, 50*time.Millisecond)
		r := row(abandoned)
		require.WithinDuration(t, restartedAt, *r.endedAt, time.Second)
		require.Equal(t, callEndAnswered, *r.reason)

		// Опоздавший участник уже не поднимает закрытый звонок.
		late := connect(after, vera)
		join(after, late, abandoned)
		require.Equal(t, []string{"call_error:room_not_found"}, events(late))

		require.Eventually(t, func() bool {
			var n int
			_ = db.QueryRow(`SELECT COUNT(*) FROM messages.messages m
				JOIN calls.rooms r ON r.chat_id = m.chat_id
				WHERE r.id = $1 AND m.type = 'call'`, abandoned).Scan(&n)
			return n == 1
		}, 3*time.Second, 50*time.Millisecond, "запись о звонке в чате — одна")
	})
}
