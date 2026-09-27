//go:build integration

package chat

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/user"
)

// Смена ключа группы на настоящей схеме (#806): изменение состава поднимает
// пометку «нужна смена ключа», снимает её смена любым участником, прежний
// ключ после изменения состава не раздаётся, из двух одновременных смен
// проходит одна.
func TestKeyRotationOnRealSchema(t *testing.T) {
	const (
		owner   = "31111111-1111-4111-8111-111111111111"
		alice   = "32222222-2222-4222-8222-222222222222"
		bob     = "33333333-3333-4333-8333-333333333333"
		charlie = "34444444-4444-4444-8444-444444444444"
	)
	db, _ := dbtest.PostgresURL(t)
	ctx := context.Background()
	for id, name := range map[string]string{owner: "owner", alice: "alice", bob: "bob", charlie: "charlie"} {
		dbtest.User(t, db, id, name)
	}
	users := user.NewService(db)
	chats := NewService(db, nil, nil)

	chatID, err := chats.CreateGroup(ctx, owner, "Команда", "", "", []string{alice, bob})
	require.NoError(t, err)

	keysFor := func(epoch int, ids ...string) []user.ChatEncryptedKey {
		keys := make([]user.ChatEncryptedKey, 0, len(ids))
		for _, id := range ids {
			keys = append(keys, user.ChatEncryptedKey{UserID: id, EncryptedKey: fmt.Sprintf("key-%d-for-%s", epoch, id)})
		}
		return keys
	}
	state := func() user.ChatKeyState {
		t.Helper()
		s, err := users.GetChatKeyState(ctx, owner, chatID)
		require.NoError(t, err)
		return s
	}
	epochOf := func(id string) int {
		t.Helper()
		var epoch int
		err := db.QueryRow(`SELECT key_epoch FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND user_id = $2`, chatID, id).Scan(&epoch)
		if err == sql.ErrNoRows {
			return 0
		}
		require.NoError(t, err)
		return epoch
	}

	// Первый ключ: эпоха 1, пометки нет.
	require.NoError(t, users.SaveChatKeys(ctx, owner, chatID, keysFor(1, owner, alice, bob), 1))
	require.Equal(t, user.ChatKeyState{KeyEpoch: 1, RotationNeeded: false}, state())

	// Эпоху нельзя перескочить и нельзя вернуть назад.
	require.ErrorIs(t, users.SaveChatKeys(ctx, owner, chatID, keysFor(3, owner), 3), user.ErrKeyEpochConflict)
	require.ErrorIs(t, users.RotateChatKey(ctx, owner, chatID, keysFor(1, owner), 1), user.ErrKeyEpochConflict)

	// Исключение поднимает пометку в той же транзакции.
	require.NoError(t, chats.RemoveMember(ctx, owner, chatID, bob))
	require.True(t, state().RotationNeeded)

	// Пока пометка поднята, прежний ключ не раздаётся.
	require.ErrorIs(t, users.SaveChatKeys(ctx, alice, chatID, keysFor(1, alice), 1), user.ErrKeyRotationRequired)

	// Меняет не владелец: Алиса. Исключённому новый ключ не пишется.
	require.NoError(t, users.RotateChatKey(ctx, alice, chatID, keysFor(2, owner, alice, bob), 2))
	require.Equal(t, user.ChatKeyState{KeyEpoch: 2, RotationNeeded: false}, state())
	require.Equal(t, 2, epochOf(alice))
	require.Equal(t, 1, epochOf(bob), "исключённый остался на прежней эпохе")

	// Доворачивание текущей эпохи без пометки разрешено.
	require.NoError(t, users.SaveChatKeys(ctx, alice, chatID, keysFor(2, owner), 2))

	// Добавление поднимает пометку: новичку прежний ключ не раздаётся.
	_, err = chats.AddMember(ctx, owner, chatID, charlie)
	require.NoError(t, err)
	require.True(t, state().RotationNeeded)
	require.ErrorIs(t, users.SaveChatKeys(ctx, alice, chatID, keysFor(2, charlie), 2), user.ErrKeyRotationRequired)
	require.Equal(t, 0, epochOf(charlie))

	// Две одновременные смены: проходит ровно одна, вторая — ErrKeyEpochConflict.
	var wg sync.WaitGroup
	results := make([]error, 2)
	for i, actor := range []string{owner, alice} {
		wg.Add(1)
		go func(i int, actor string) {
			defer wg.Done()
			keys := make([]user.ChatEncryptedKey, 0, 3)
			for _, id := range []string{owner, alice, charlie} {
				keys = append(keys, user.ChatEncryptedKey{UserID: id, EncryptedKey: fmt.Sprintf("epoch3-by-%s-for-%s", actor, id)})
			}
			results[i] = users.RotateChatKey(ctx, actor, chatID, keys, 3)
		}(i, actor)
	}
	wg.Wait()
	var won, conflicted int
	for _, err := range results {
		switch {
		case err == nil:
			won++
		case err == user.ErrKeyEpochConflict:
			conflicted++
		default:
			t.Fatalf("неожиданная ошибка: %v", err)
		}
	}
	require.Equal(t, 1, won)
	require.Equal(t, 1, conflicted)
	require.Equal(t, user.ChatKeyState{KeyEpoch: 3, RotationNeeded: false}, state())

	// Все строки эпохи 3 записаны одним участником — одним ключом.
	rows, err := db.Query(`SELECT encrypted_key FROM crypto.chat_encryption_keys WHERE chat_id = $1 AND key_epoch = 3`, chatID)
	require.NoError(t, err)
	authors := map[string]bool{}
	for rows.Next() {
		var key string
		require.NoError(t, rows.Scan(&key))
		var author, recipient string
		_, err := fmt.Sscanf(key, "epoch3-by-%36s-for-%36s", &author, &recipient)
		require.NoError(t, err)
		authors[author] = true
	}
	require.NoError(t, rows.Err())
	require.Len(t, authors, 1, "строки эпохи 3 не должны смешивать ключи двух участников")

	// Выход и бан тоже поднимают пометку.
	require.NoError(t, chats.LeaveChat(ctx, charlie, chatID))
	require.True(t, state().RotationNeeded)
	require.NoError(t, users.RotateChatKey(ctx, owner, chatID, keysFor(4, owner, alice), 4))
	require.False(t, state().RotationNeeded)
	require.NoError(t, chats.BanMember(ctx, owner, chatID, alice, nil, ""))
	require.True(t, state().RotationNeeded)
}
