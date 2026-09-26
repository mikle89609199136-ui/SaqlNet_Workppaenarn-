package presence

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMemoryStore_Disconnect_CleansUpEmptyUserMap проверяет, что при отключении последнего
// соединения пользователя удаляется сама запись пользователя из карты leases, исключая утечку памяти.
func TestMemoryStore_Disconnect_CleansUpEmptyUserMap(t *testing.T) {
	store := NewMemoryStore(nil)
	ctx := context.Background()
	userID := "user-leak-test"
	connID := "conn-1"

	err := store.Connect(ctx, userID, connID)
	require.NoError(t, err)
	require.Equal(t, 1, len(store.leases))

	err = store.Disconnect(ctx, userID, connID)
	require.NoError(t, err)
	require.Equal(t, 0, len(store.leases))
	require.NotContains(t, store.leases, userID)
}
