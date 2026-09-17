package presence_test

import (
	"context"
	"craneapp/backend-v2/internal/presence"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Пустой вход OnlineUsers в RedisStore возвращает пустой срез без ошибки
// и без обращения к Redis (даже если клиент nil).
func TestRedisStore_OnlineUsers_EmptyInput(t *testing.T) {
	store := presence.NewRedisStore(nil)
	ctx := context.Background()

	t.Run("nil userIDs", func(t *testing.T) {
		online, err := store.OnlineUsers(ctx, nil)
		require.NoError(t, err)
		require.Empty(t, online)
	})

	t.Run("empty slice", func(t *testing.T) {
		online, err := store.OnlineUsers(ctx, []string{})
		require.NoError(t, err)
		require.Empty(t, online)
	})
}

// TestRedisStore_Heartbeat_RestoresLease проверяет на реальной семантике Redis (через miniredis),
// что вызов Heartbeat восстанавливает потерянный lease (upsert), делает пользователя online,
// а также корректно истекает по TTL без использования реального времени.
func TestRedisStore_Heartbeat_RestoresLease(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	current := time.Now()
	store := presence.NewRedisStore(client, func() time.Time { return current })
	userID := "user-1"
	connID := "conn-1"
	ctx := context.Background()
	err = store.Heartbeat(ctx, userID, connID)
	require.NoError(t, err)

	online, err := store.OnlineUsers(ctx, []string{userID})
	require.NoError(t, err)
	require.Equal(t, []string{userID}, online)

	current = current.Add(presence.LeaseTTL + time.Second)
	mr.FastForward(presence.LeaseTTL + time.Second)
	online, err = store.OnlineUsers(ctx, []string{userID})
	require.NoError(t, err)
	require.Empty(t, online, "пользователь должен стать offline после истечения LeaseTTL")
	err = store.Heartbeat(ctx, userID, connID)
	require.NoError(t, err)
	online, err = store.OnlineUsers(ctx, []string{userID})
	require.NoError(t, err)
	require.Equal(t, []string{userID}, online, "пользователь должен снова стать online после Heartbeat")

	err = store.Disconnect(ctx, userID, connID)
	require.NoError(t, err)
	online, err = store.OnlineUsers(ctx, []string{userID})
	require.NoError(t, err)
	require.Empty(t, online, "пользователь должен стать offline после Disconnect")
}
