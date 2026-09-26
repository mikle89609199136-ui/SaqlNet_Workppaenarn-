//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/user"
)

// blockRecorder собирает рассылки слушателя блокировок.
type blockRecorder struct {
	mu     sync.Mutex
	events []map[string]any
	to     [][]string
}

func (r *blockRecorder) BroadcastToUsers(userIDs []string, payload []byte) {
	var event map[string]any
	_ = json.Unmarshal(payload, &event)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
	r.to = append(r.to, userIDs)
}

func (r *blockRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.events)
}

func (r *blockRecorder) last() (map[string]any, []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.events[len(r.events)-1], r.to[len(r.to)-1]
}

// Блокировка на настоящей схеме (#760): уведомление после коммита доходит
// до слушателя chat и обоим; заблокированный не может писать; флаги чата.
func TestBlockOnRealSchema(t *testing.T) {
	const (
		blocker = "11111111-1111-4111-8111-111111111111"
		blocked = "22222222-2222-4222-8222-222222222222"
	)
	db, url := dbtest.PostgresURL(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	dbtest.User(t, db, blocker, "blocker")
	dbtest.User(t, db, blocked, "blocked")
	users := user.NewService(db)
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, blocker, blocked)
	require.NoError(t, err)

	events := &blockRecorder{}
	go BlockChangeRelay(ctx, url, db, events)
	// Слушатель подписывается асинхронно: ждём, пока он начнёт слушать.
	time.Sleep(500 * time.Millisecond)

	waitEvent := func(n int) (map[string]any, []string) {
		t.Helper()
		require.Eventually(t, func() bool { return events.count() >= n }, 5*time.Second, 20*time.Millisecond)
		return events.last()
	}

	// До блокировки писать можно.
	_, err = chats.SendMessage(ctx, blocked, chatID, "до блокировки", "text", nil, nil)
	require.NoError(t, err)

	require.NoError(t, users.Block(ctx, blocker, blocked))
	event, to := waitEvent(1)
	require.Equal(t, map[string]any{"type": "user_blocked", "userId": blocker, "blockedUserId": blocked, "chatId": chatID}, event)
	require.ElementsMatch(t, []string{blocker, blocked}, to)

	// Повторная блокировка: ошибка и без второго уведомления.
	require.ErrorIs(t, users.Block(ctx, blocker, blocked), user.ErrAlreadyBlocked)

	_, err = chats.SendMessage(ctx, blocked, chatID, "после блокировки", "text", nil, nil)
	require.ErrorIs(t, err, ErrBlockedByUser)
	var stored int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM messages.messages WHERE content = 'после блокировки'`).Scan(&stored))
	require.Zero(t, stored, "сообщение не сохранено")

	// Заблокировавший может писать — ограничение одностороннее.
	_, err = chats.SendMessage(ctx, blocker, chatID, "от заблокировавшего", "text", nil, nil)
	require.NoError(t, err)

	seenByBlocked, err := chats.Get(ctx, blocked, chatID)
	require.NoError(t, err)
	require.True(t, seenByBlocked.IsBlockedByPeer)
	require.False(t, seenByBlocked.IsPeerBlocked)
	seenByBlocker, err := chats.Get(ctx, blocker, chatID)
	require.NoError(t, err)
	require.True(t, seenByBlocker.IsPeerBlocked)
	require.False(t, seenByBlocker.IsBlockedByPeer)

	require.NoError(t, users.Unblock(ctx, blocker, blocked))
	event, _ = waitEvent(2)
	require.Equal(t, "user_unblocked", event["type"])
	require.Equal(t, 2, events.count(), "повторная блокировка не дала лишнего события")

	_, err = chats.SendMessage(ctx, blocked, chatID, "после разблокировки", "text", nil, nil)
	require.NoError(t, err)
	afterUnblock, err := chats.Get(ctx, blocked, chatID)
	require.NoError(t, err)
	require.False(t, afterUnblock.IsBlockedByPeer)

	// Снять несуществующую блокировку — без события.
	require.NoError(t, users.Unblock(ctx, blocker, blocked))
	time.Sleep(300 * time.Millisecond)
	require.Equal(t, 2, events.count())
}
