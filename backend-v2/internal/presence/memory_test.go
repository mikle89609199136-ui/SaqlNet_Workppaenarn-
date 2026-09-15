package presence_test

import (
	"context"
	"craneapp/backend-v2/internal/presence"
	"sync"
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

// Heartbeat восстанавливает потерянную lease активного соединения (например, после рестарта хранилища),
// создавая запись со сроком LeaseTTL и делая пользователя online.
func TestHeartbeat_RestoresLease(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	err := store.Heartbeat(context.Background(), testUserID, testConnectionID)
	require.NoError(t, err)
	online, err := store.OnlineUsers(context.Background(), []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{testUserID}, online)
}

// Конкурентный доступ к MemoryStore из нескольких горутин не вызывает data race и паник.
func TestMemoryStore_ConcurrentAccess(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	ctx := context.Background()

	const goroutines = 10
	const iterations = 50

	var wg sync.WaitGroup
	wg.Add(goroutines * 4)

	for i := 0; i < goroutines; i++ {
		uid := testUserID
		cid := testConnectionID

		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				_ = store.Connect(ctx, uid, cid)
			}
		}()

		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				_ = store.Heartbeat(ctx, uid, cid)
			}
		}()

		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				_, _ = store.OnlineUsers(ctx, []string{uid})
			}
		}()

		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				_ = store.Disconnect(ctx, uid, cid)
			}
		}()
	}

	wg.Wait()
}

// OnlineUsers корректно фильтрует список из нескольких пользователей, сохраняя порядок,
// и игнорирует неизвестных пользователей.
func TestOnlineUsers_MultipleUsersOrderAndUnknown(t *testing.T) {
	store := presence.NewMemoryStore(time.Now)
	ctx := context.Background()

	user1 := "550e8400-e29b-41d4-a716-446655440011"
	user2 := "550e8400-e29b-41d4-a716-446655440012"
	userUnknown := "550e8400-e29b-41d4-a716-446655440013"

	require.NoError(t, store.Connect(ctx, user1, "conn-1"))
	require.NoError(t, store.Connect(ctx, user2, "conn-2"))

	online, err := store.OnlineUsers(ctx, []string{userUnknown, user2, user1})
	require.NoError(t, err)
	require.Equal(t, []string{user2, user1}, online)
}

// Пользователь остаётся online, если хотя бы одно соединение активно,
// даже при наличии истёкших соединений.
func TestOnlineUsers_MixedActiveAndExpiredConnections(t *testing.T) {
	current := time.Now()
	store := presence.NewMemoryStore(func() time.Time { return current })
	ctx := context.Background()

	// Первое соединение создано в T0
	require.NoError(t, store.Connect(ctx, testUserID, testConnectionID))

	// Перемещаемся на 30 секунд вперёд и подключаем второе соединение
	current = current.Add(30 * time.Second)
	require.NoError(t, store.Connect(ctx, testUserID, testConnectionID2))

	// Перемещаемся так, что первое соединение уже истекло (T0 + 80s > LeaseTTL 75s),
	// а второе всё ещё живо (T0 + 30s + 50s = 80s < 105s)
	current = current.Add(50 * time.Second)

	online, err := store.OnlineUsers(ctx, []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{testUserID}, online)

	// Перемещаемся ещё вперёд — теперь истекло и второе соединение
	current = current.Add(30 * time.Second)
	online, err = store.OnlineUsers(ctx, []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{}, online)
}

// NewMemoryStore с nil в качестве источника времени использует time.Now по умолчанию
// и не паникует при вызовах методов.
func TestNewMemoryStore_NilNowDefaultsToTimeNow(t *testing.T) {
	store := presence.NewMemoryStore(nil)
	ctx := context.Background()

	err := store.Connect(ctx, testUserID, testConnectionID)
	require.NoError(t, err)

	online, err := store.OnlineUsers(ctx, []string{testUserID})
	require.NoError(t, err)
	require.Equal(t, []string{testUserID}, online)
}
