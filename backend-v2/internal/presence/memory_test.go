package presence_test

import (
	"context"
	"craneapp/backend-v2/internal/presence"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const (
	testUserID        = "550e8400-e29b-41d4-a716-446655440001"
	testConnectionID  = "550e8400-e29b-41d4-a716-446655440002"
	testConnectionID2 = "550e8400-e29b-41d4-a716-446655440003"
)

// Пустой вход OnlineUsers возвращает пустой непустой-nil результат без ошибки.
func TestOnlineUsers_EmptyInput(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	online, err := store.OnlineUsers(context.Background(), nil)
	require.NoError(t, err)
	require.Empty(t, online)
}

// Disconnect несуществующего lease — no-op без ошибки: повторный или потерянный
// disconnect не должен ломать сервис.
func TestDisconnect_UnknownLease(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	err := store.Disconnect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
}

// Connect создаёт lease: после подключения пользователь online.
func TestConnect_MakesUserOnline(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	err := store.Connect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{testUserID}, online)
}

// Disconnect одного из нескольких соединений: пользователь остаётся online, пока живо хотя бы одно.
func TestDisconnect_OtherConnectionKeepsOnline(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	err := store.Connect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	err = store.Connect(context.Background(), testUserID, testConnectionID2)
	require.NoError(t, err)
	err = store.Disconnect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{testUserID}, online)
}

// Disconnect последнего живого соединения: пользователь offline.
func TestDisconnect_LastConnectionGoesOffline(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	err := store.Connect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	err = store.Connect(context.Background(), testUserID, testConnectionID2)
	require.NoError(t, err)
	err = store.Disconnect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	err = store.Disconnect(context.Background(), testUserID, testConnectionID2)
	require.NoError(t, err)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{}, online)
}

// Lease с истёкшим expiresAt не делает пользователя online;
// истёкшие lease удаляются при чтении.
func TestOnlineUsers_CleanExpires(t *testing.T) {
	current := time.Now()
	store := presence.NewMemoryStore(func() time.Time { return current })
	err := store.Connect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	current = current.Add(presence.LeaseTTL + time.Second)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{}, online)
}

// Heartbeat продлевает TTL конкретного соединения, не трогая другие
func TestHeartbeat_ExtendsLease(t *testing.T) {
	current := time.Now()
	store := presence.NewMemoryStore(func() time.Time { return current })
	err := store.Connect(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	err = store.Connect(context.Background(), testUserID, testConnectionID2)
	require.NoError(t, err)

	current = current.Add(presence.LeaseTTL - time.Second)
	err = store.Heartbeat(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)

	current = current.Add(2 * time.Second)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{testUserID}, online)
	current = current.Add(presence.LeaseTTL + time.Second)
	online, err = store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{}, online)
}

// Heartbeat несуществующего connectionID не воскрешает пользователя.
func TestHeartbeat_UnknownConnectionNoResurrect(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	err := store.Heartbeat(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{}, online)
}
