//go:build integration

package chat

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Отметка прочтения по переданным сообщениям на настоящей схеме (#506):
// граница — самое новое из переданных, а не «сейчас», и не назад.
func TestMarkReadOnRealSchema(t *testing.T) {
	const (
		me      = "a1111111-1111-4111-8111-111111111111"
		peer    = "a2222222-2222-4222-8222-222222222222"
		third   = "a3333333-3333-4333-8333-333333333333"
		missing = "a9999999-9999-4999-8999-999999999999"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, me, "read_me")
	dbtest.User(t, db, peer, "read_peer")
	dbtest.User(t, db, third, "read_third")
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, me, peer)
	require.NoError(t, err)
	otherChat, _, err := chats.CreatePrivate(ctx, peer, third)
	require.NoError(t, err)

	send := func(chat, from, content string) string {
		sent, err := chats.SendMessages(ctx, from, chat, []OutgoingMessage{{Content: content, Type: "text"}})
		require.NoError(t, err)
		return sent[0].ID
	}
	unread := func() int {
		chat, err := chats.Get(ctx, me, chatID)
		require.NoError(t, err)
		return chat.UnreadCount
	}

	m1 := send(chatID, peer, "первое")
	m2 := send(chatID, peer, "второе")
	m3 := send(chatID, peer, "третье")
	foreign := send(otherChat, peer, "из другого чата")
	require.Equal(t, 3, unread())

	t.Run("отметка первого не закрывает более новые", func(t *testing.T) {
		mark, err := chats.MarkMessagesRead(ctx, me, chatID, []string{m1})
		require.NoError(t, err)
		require.Equal(t, []string{m1}, mark.ReadIDs)
		require.NotEmpty(t, mark.LastReadAt)
		require.Equal(t, 2, unread(), "второе и третье — непрочитаны")
	})

	t.Run("чужой или несуществующий ID — отказ, отметка на месте", func(t *testing.T) {
		_, err := chats.MarkMessagesRead(ctx, me, chatID, []string{m2, foreign})
		require.ErrorIs(t, err, ErrInvalidMessageIDs)
		_, err = chats.MarkMessagesRead(ctx, me, chatID, []string{missing})
		require.ErrorIs(t, err, ErrInvalidMessageIDs)
		require.Equal(t, 2, unread())
	})

	t.Run("граница не сдвигается назад", func(t *testing.T) {
		_, err := chats.MarkMessagesRead(ctx, me, chatID, []string{m3})
		require.NoError(t, err)
		require.Equal(t, 0, unread())

		mark, err := chats.MarkMessagesRead(ctx, me, chatID, []string{m1})
		require.NoError(t, err)
		require.Equal(t, 0, unread(), "запоздалая отметка старого сообщения не вернула непрочитанные")
		require.Equal(t, []string{m1}, mark.ReadIDs)
	})

	t.Run("свои и удалённые не двигают границу", func(t *testing.T) {
		mine := send(chatID, me, "моё")
		m4 := send(chatID, peer, "четвёртое")
		m5 := send(chatID, peer, "пятое, будет удалено")
		_, err := chats.DeleteMessages(ctx, peer, chatID, []string{m5}, true)
		require.NoError(t, err)
		before := unread()

		mark, err := chats.MarkMessagesRead(ctx, me, chatID, []string{mine, m5})
		require.NoError(t, err)
		require.Empty(t, mark.ReadIDs)
		require.Equal(t, before, unread(), "четвёртое по-прежнему непрочитано")

		_, err = chats.MarkMessagesRead(ctx, me, chatID, []string{m4})
		require.NoError(t, err)
		require.Equal(t, 0, unread())
	})

	t.Run("не участник чата не отмечает", func(t *testing.T) {
		_, err := chats.MarkMessagesRead(ctx, third, chatID, []string{m1})
		require.ErrorIs(t, err, ErrForbidden)
	})

	t.Run("«Отметить чат прочитанным» закрывает весь чат", func(t *testing.T) {
		send(chatID, peer, "шестое")
		send(chatID, peer, "седьмое")
		require.Equal(t, 2, unread())
		require.NoError(t, chats.MarkRead(ctx, me, chatID))
		require.Equal(t, 0, unread())
	})
}
