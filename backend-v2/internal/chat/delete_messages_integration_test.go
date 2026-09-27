//go:build integration

package chat

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Удаление у себя и у всех на настоящей схеме (#840).
func TestDeleteMessagesOnRealSchema(t *testing.T) {
	const (
		me      = "66666666-6666-4666-8666-666666666666"
		peer    = "77777777-7777-4777-8777-777777777777"
		outside = "88888888-8888-4888-8888-888888888888"
		missing = "99999999-9999-4999-8999-999999999999"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, me, "delete_me")
	dbtest.User(t, db, peer, "delete_peer")
	dbtest.User(t, db, outside, "delete_outside")
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, me, peer)
	require.NoError(t, err)

	send := func(from, content string) string {
		sent, err := chats.SendMessages(ctx, from, chatID, []OutgoingMessage{{Content: content, Type: "text"}})
		require.NoError(t, err)
		return sent[0].ID
	}
	mine := send(me, "моё")
	theirs := send(peer, "чужое")
	reply := send(peer, "ответ на моё")
	_, err = db.ExecContext(ctx, `UPDATE messages.messages SET reply_to = $1 WHERE id = $2`, theirs, reply)
	require.NoError(t, err)
	last := send(me, "последнее моё")

	contents := func(viewer string) []string {
		listed, err := chats.ListMessages(ctx, viewer, chatID, 50, 0)
		require.NoError(t, err)
		out := make([]string, len(listed))
		for i, msg := range listed {
			out[i] = msg.Content
		}
		return out
	}

	t.Run("у всех — только свои: чужое в пачке отклоняет всю пачку", func(t *testing.T) {
		_, err := chats.DeleteMessages(ctx, me, chatID, []string{mine, theirs}, true)
		require.ErrorIs(t, err, ErrForbidden)
		require.Contains(t, contents(peer), "моё", "своё из отклонённой пачки не удалено")
	})

	t.Run("несуществующее сообщение — не найдено, ничего не скрыто", func(t *testing.T) {
		_, err := chats.DeleteMessages(ctx, me, chatID, []string{theirs, missing}, false)
		require.ErrorIs(t, err, ErrNotFound)
		require.Contains(t, contents(me), "чужое")
	})

	t.Run("не участник чата не удаляет", func(t *testing.T) {
		_, err := chats.DeleteMessages(ctx, outside, chatID, []string{theirs}, false)
		require.ErrorIs(t, err, ErrForbidden)
	})

	t.Run("у себя — чужое пропадает только у меня", func(t *testing.T) {
		lastMessage, err := chats.DeleteMessages(ctx, me, chatID, []string{theirs}, false)
		require.NoError(t, err)
		require.NotNil(t, lastMessage)
		require.Equal(t, last, lastMessage.ID)

		require.NotContains(t, contents(me), "чужое")
		require.Contains(t, contents(peer), "чужое", "у автора сообщение осталось")

		// Повтор безопасен: скрытое скрыть ещё раз можно.
		_, err = chats.DeleteMessages(ctx, me, chatID, []string{theirs}, false)
		require.NoError(t, err)
	})

	t.Run("цитата ответа на скрытое — как на удалённое", func(t *testing.T) {
		listed, err := chats.ListMessages(ctx, me, chatID, 50, 0)
		require.NoError(t, err)
		for _, msg := range listed {
			if msg.ID == reply {
				require.Nil(t, msg.ReplyPreview)
			}
		}
		listed, err = chats.ListMessages(ctx, peer, chatID, 50, 0)
		require.NoError(t, err)
		for _, msg := range listed {
			if msg.ID == reply {
				require.NotNil(t, msg.ReplyPreview, "у собеседника цитата на месте")
			}
		}
	})

	t.Run("скрытое не считается в непрочитанных и не становится последним", func(t *testing.T) {
		// Скрываем всё, что написал собеседник, — непрочитанных не остаётся.
		_, err := chats.DeleteMessages(ctx, me, chatID, []string{reply}, false)
		require.NoError(t, err)
		chat, err := chats.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.Equal(t, 0, chat.UnreadCount)

		// Последнее своё скрыто у себя — превью показывает предыдущее.
		lastMessage, err := chats.DeleteMessages(ctx, me, chatID, []string{last}, false)
		require.NoError(t, err)
		require.Equal(t, mine, lastMessage.ID)
		chat, err = chats.Get(ctx, me, chatID)
		require.NoError(t, err)
		require.NotNil(t, chat.LastMessage)
		require.Equal(t, mine, chat.LastMessage.ID)

		peerView, err := chats.Get(ctx, peer, chatID)
		require.NoError(t, err)
		require.Equal(t, last, peerView.LastMessage.ID, "у собеседника последнее — прежнее")
	})

	t.Run("у всех — своё пропадает у обоих", func(t *testing.T) {
		_, err := chats.DeleteMessages(ctx, me, chatID, []string{mine}, true)
		require.NoError(t, err)
		require.NotContains(t, contents(peer), "моё")
		require.NotContains(t, contents(me), "моё")
	})
}
