//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// receiptsRealtime — сокеты для теста: кто подключён и какие события
// ушли. Безопасен для параллельных отметок.
type receiptsRealtime struct {
	mu        sync.Mutex
	connected map[string]bool
	events    []ReceiptEvent
	excluded  []string
}

func (*receiptsRealtime) CallRooms() *CallRoomManager { return nil }

func (r *receiptsRealtime) IsUserConnected(userID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.connected[userID]
}

func (r *receiptsRealtime) BroadcastToChat(_ string, payload []byte, exclude string) {
	var event ReceiptEvent
	if json.Unmarshal(payload, &event) != nil || event.Type != "receipts" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
	r.excluded = append(r.excluded, exclude)
}

func (*receiptsRealtime) BroadcastToUsers([]string, []byte) {}

func (r *receiptsRealtime) setConnected(userID string, connected bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connected[userID] = connected
}

// take отдаёт накопленные события и очищает список.
func (r *receiptsRealtime) take() []ReceiptEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	events := r.events
	r.events, r.excluded = nil, nil
	return events
}

// Статусы доставки и прочтения на настоящей схеме (#657): границы только
// вперёд, время — первый сдвиг через сообщение, события автору.
func TestReceiptsOnRealSchema(t *testing.T) {
	const (
		me    = "b1111111-1111-4111-8111-111111111111"
		peer  = "b2222222-2222-4222-8222-222222222222"
		third = "b3333333-3333-4333-8333-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, me, "receipts_me")
	dbtest.User(t, db, peer, "receipts_peer")
	dbtest.User(t, db, third, "receipts_third")
	ws := &receiptsRealtime{connected: map[string]bool{}}
	chats := NewService(db, ws, nil)
	chatID, _, err := chats.CreatePrivate(ctx, me, peer)
	require.NoError(t, err)

	send := func(chat, from, content string) Message {
		t.Helper()
		sent, err := chats.SendMessages(ctx, from, chat, []OutgoingMessage{{Content: content, Type: "text"}})
		require.NoError(t, err)
		return sent[0]
	}
	// mine — моё сообщение глазами автора, как в ленте.
	mine := func(chat, id string) Message {
		t.Helper()
		messages, err := chats.ListMessages(ctx, me, chat, 200, 0)
		require.NoError(t, err)
		for _, msg := range messages {
			if msg.ID == id {
				return msg
			}
		}
		t.Fatalf("сообщение %s не найдено в ленте", id)
		return Message{}
	}
	marks := func(kind string) int {
		t.Helper()
		var count int
		require.NoError(t, db.QueryRow(
			`SELECT COUNT(*) FROM chats.receipt_marks WHERE chat_id = $1 AND user_id = $2 AND kind = $3`,
			chatID, peer, kind,
		).Scan(&count))
		return count
	}

	t.Run("получатель офлайн — только отправлено", func(t *testing.T) {
		msg := send(chatID, me, "первое")
		require.Empty(t, msg.DeliveredAt)
		got := mine(chatID, msg.ID)
		require.Empty(t, got.DeliveredAt)
		require.Empty(t, got.ReadAt)
		require.Empty(t, ws.take())
	})

	t.Run("получатель в сети — доставлено сразу: в ответе и событием", func(t *testing.T) {
		ws.setConnected(peer, true)
		defer ws.setConnected(peer, false)
		msg := send(chatID, me, "второе")
		require.NotEmpty(t, msg.DeliveredAt, "автор видит доставку уже в ответе на отправку")
		require.Empty(t, msg.ReadAt)
		require.Equal(t, msg.DeliveredAt, mine(chatID, msg.ID).DeliveredAt)

		events := ws.take()
		require.Len(t, events, 1)
		require.Equal(t, ReceiptEvent{
			Type: "receipts", ChatID: chatID, UserID: peer, Kind: ReceiptDelivered,
			UpTo: events[0].UpTo, At: msg.DeliveredAt,
		}, events[0])
	})

	t.Run("получатель загрузил список чатов — доставлено", func(t *testing.T) {
		msg := send(chatID, me, "третье")
		require.Empty(t, mine(chatID, msg.ID).DeliveredAt)

		_, err := chats.List(ctx, peer, false)
		require.NoError(t, err)
		events := ws.take()
		require.Len(t, events, 1)
		require.Equal(t, ReceiptDelivered, events[0].Kind)

		list, err := chats.List(ctx, me, false)
		require.NoError(t, err)
		require.Len(t, list, 1)
		require.Equal(t, msg.ID, list[0].LastMessage.ID)
		require.Equal(t, events[0].At, list[0].LastMessage.DeliveredAt, "последнее сообщение в списке чатов")
		require.Empty(t, list[0].LastMessage.ReadAt)

		_, err = chats.List(ctx, peer, false)
		require.NoError(t, err)
		require.Empty(t, ws.take(), "повторная загрузка ничего не сдвигает")
	})

	t.Run("получатель загрузил ленту — доставлено", func(t *testing.T) {
		msg := send(chatID, me, "четвёртое")
		_, err := chats.ListMessages(ctx, peer, chatID, 50, 0)
		require.NoError(t, err)
		require.Len(t, ws.take(), 1)
		require.NotEmpty(t, mine(chatID, msg.ID).DeliveredAt)
	})

	t.Run("прочтение — время первого сдвига, повтор ничего не меняет", func(t *testing.T) {
		msg := send(chatID, me, "пятое")
		require.Empty(t, mine(chatID, msg.ID).DeliveredAt)
		readBefore := marks(ReceiptRead)

		_, err := chats.MarkMessagesRead(ctx, peer, chatID, []string{msg.ID})
		require.NoError(t, err)
		got := mine(chatID, msg.ID)
		require.NotEmpty(t, got.ReadAt)
		require.Equal(t, got.ReadAt, got.DeliveredAt, "прочитанное — доставлено тем же сдвигом")
		kinds := map[string]bool{}
		for _, event := range ws.take() {
			kinds[event.Kind] = true
		}
		require.Equal(t, map[string]bool{ReceiptDelivered: true, ReceiptRead: true}, kinds)

		_, err = chats.MarkMessagesRead(ctx, peer, chatID, []string{msg.ID})
		require.NoError(t, err)
		require.NoError(t, chats.MarkRead(ctx, peer, chatID))
		again := mine(chatID, msg.ID)
		require.Equal(t, got.ReadAt, again.ReadAt, "время прочтения — первое, а не последнее")
		require.Equal(t, got.DeliveredAt, again.DeliveredAt)
		require.Equal(t, readBefore+2, marks(ReceiptRead), "повтор не пишет журнал, «весь чат» — один сдвиг")
		ws.take()
	})

	t.Run("отметка старого не делает прочитанным более новое", func(t *testing.T) {
		older := send(chatID, me, "шестое")
		newer := send(chatID, me, "седьмое")
		_, err := chats.MarkMessagesRead(ctx, peer, chatID, []string{older.ID})
		require.NoError(t, err)
		require.NotEmpty(t, mine(chatID, older.ID).ReadAt)
		require.Empty(t, mine(chatID, newer.ID).ReadAt)
		ws.take()
	})

	t.Run("свои себе не отмечаются, у чужих сообщений полей нет", func(t *testing.T) {
		msg := send(chatID, me, "восьмое")
		require.NoError(t, chats.MarkRead(ctx, me, chatID))
		got := mine(chatID, msg.ID)
		require.Empty(t, got.ReadAt, "отметка автора не читает его же сообщение")
		require.Empty(t, got.DeliveredAt)

		peerView, err := chats.ListMessages(ctx, peer, chatID, 200, 0)
		require.NoError(t, err)
		for _, m := range peerView {
			if m.SenderID == me {
				require.Empty(t, m.ReadAt, "время прочтения видит только автор")
				require.Empty(t, m.DeliveredAt)
			}
		}
		ws.take()
	})

	t.Run("параллельные отметки — один сдвиг, одно событие", func(t *testing.T) {
		msg := send(chatID, me, "девятое")
		readBefore := marks(ReceiptRead)
		var wg sync.WaitGroup
		for range 8 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := chats.MarkMessagesRead(ctx, peer, chatID, []string{msg.ID})
				assert.NoError(t, err)
			}()
		}
		wg.Wait()
		require.Equal(t, readBefore+1, marks(ReceiptRead))
		read := 0
		for _, event := range ws.take() {
			if event.Kind == ReceiptRead {
				read++
			}
		}
		require.Equal(t, 1, read)
	})

	t.Run("группа: время считается, событие не рассылается", func(t *testing.T) {
		groupID, err := chats.CreateGroup(ctx, me, "Статусы", "", "", []string{peer, third})
		require.NoError(t, err)
		msg := send(groupID, me, "всем")
		require.Empty(t, mine(groupID, msg.ID).ReadAt)

		_, err = chats.MarkMessagesRead(ctx, third, groupID, []string{msg.ID})
		require.NoError(t, err)
		got := mine(groupID, msg.ID)
		require.NotEmpty(t, got.ReadAt, "прочитано хотя бы одним участником")
		require.NotEmpty(t, got.DeliveredAt)
		require.Empty(t, ws.take())
	})
}

// Перенос прочитанного до выпуска (#657): миграция заносит нынешнюю
// last_read_at в журнал, «доставлено» стартует от неё; повторный прогон не
// подменяет настоящие записи.
func TestReceiptsMigrationBackfill(t *testing.T) {
	const (
		author = "c1111111-1111-4111-8111-111111111111"
		reader = "c2222222-2222-4222-8222-222222222222"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, author, "backfill_author")
	dbtest.User(t, db, reader, "backfill_reader")
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, author, reader)
	require.NoError(t, err)
	sent, err := chats.SendMessages(ctx, author, chatID, []OutgoingMessage{{Content: "до выпуска", Type: "text"}})
	require.NoError(t, err)

	// Состояние до выпуска: отметка есть, журнала и «доставлено» нет.
	_, err = db.Exec(`
		INSERT INTO chats.user_chat_settings (user_id, chat_id, last_read_at)
		VALUES ($1, $2, NOW() + INTERVAL '1 minute')
		ON CONFLICT (user_id, chat_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at, last_delivered_at = NULL
	`, reader, chatID)
	require.NoError(t, err)
	_, err = db.Exec(`DELETE FROM chats.receipt_marks`)
	require.NoError(t, err)

	_, self, _, _ := runtime.Caller(0)
	migration, err := os.ReadFile(filepath.Join(filepath.Dir(self), "..", "..", "migrations", "0033_receipt_marks.sql"))
	require.NoError(t, err)
	_, err = db.Exec(string(migration))
	require.NoError(t, err)

	var readAt, deliveredAt, lastReadAt string
	require.NoError(t, db.QueryRow(`
		SELECT last_read_at::text, last_delivered_at::text FROM chats.user_chat_settings WHERE user_id = $1 AND chat_id = $2
	`, reader, chatID).Scan(&lastReadAt, &deliveredAt))
	require.Equal(t, lastReadAt, deliveredAt, "«доставлено» стартует от «прочитано»")

	messages, err := chats.ListMessages(ctx, author, chatID, 10, 0)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	require.Equal(t, sent[0].ID, messages[0].ID)
	readAt = messages[0].ReadAt
	require.NotEmpty(t, readAt)
	require.Equal(t, readAt, messages[0].DeliveredAt)

	// Настоящий сдвиг после выпуска, потом повторный прогон миграции: ни
	// новых записей, ни подмены времени.
	_, err = chats.SendMessages(ctx, author, chatID, []OutgoingMessage{{Content: "после", Type: "text"}})
	require.NoError(t, err)
	require.NoError(t, chats.MarkRead(ctx, reader, chatID))
	var before, after int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM chats.receipt_marks`).Scan(&before))
	_, err = db.Exec(string(migration))
	require.NoError(t, err)
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM chats.receipt_marks`).Scan(&after))
	require.Equal(t, before, after)

	messages, err = chats.ListMessages(ctx, author, chatID, 10, 0)
	require.NoError(t, err)
	require.Equal(t, readAt, messages[0].ReadAt)
}
