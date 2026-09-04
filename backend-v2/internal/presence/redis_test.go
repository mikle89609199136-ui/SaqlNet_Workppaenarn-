package presence_test

import (
	"context"
	"craneapp/backend-v2/internal/presence"
	"testing"

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
