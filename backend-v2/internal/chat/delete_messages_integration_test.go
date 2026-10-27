//go:build integration

package chat

import (
	"context"
	"encoding/json"
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
		_, err := chats.DeleteMessages(ctx, peer, chatID, []string{mine, theirs}, true)
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

// Права удаления у всех и чтение скрытого (#840).
func TestDeleteMessagesPermissionsAndHiddenReads(t *testing.T) {
	const (
		owner  = "b1111111-1111-4111-8111-111111111111"
		admin  = "b2222222-2222-4222-8222-222222222222"
		member = "b3333333-3333-4333-8333-333333333333"
		author = "b4444444-4444-4444-8444-444444444444"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, owner, "delete_owner")
	dbtest.User(t, db, admin, "delete_admin")
	dbtest.User(t, db, member, "delete_member")
	dbtest.User(t, db, author, "delete_author")
	chats := NewService(db, nil, nil)

	groupID, err := chats.CreateGroup(ctx, owner, "Удаление", "", "", []string{admin, member})
	require.NoError(t, err)
	require.NoError(t, chats.SetMemberRole(ctx, owner, groupID, admin, "admin"))

	send := func(chat, from, content string) string {
		sent, err := chats.SendMessages(ctx, from, chat, []OutgoingMessage{{Content: content, Type: "text"}})
		require.NoError(t, err)
		return sent[0].ID
	}
	sees := func(viewer, chat, content string) bool {
		listed, err := chats.ListMessages(ctx, viewer, chat, 50, 0)
		require.NoError(t, err)
		for _, msg := range listed {
			if msg.Content == content {
				return true
			}
		}
		return false
	}

	t.Run("владелец удаляет чужое у всех", func(t *testing.T) {
		id := send(groupID, member, "сообщение участника")
		_, err := chats.DeleteMessages(ctx, owner, groupID, []string{id}, true)
		require.NoError(t, err)
		require.False(t, sees(owner, groupID, "сообщение участника"))
		require.False(t, sees(member, groupID, "сообщение участника"))
	})

	t.Run("админ без права удалять сообщения получает отказ", func(t *testing.T) {
		id := send(groupID, member, "без права")
		_, err := chats.DeleteMessages(ctx, admin, groupID, []string{id}, true)
		require.ErrorIs(t, err, ErrForbidden)
		require.True(t, sees(member, groupID, "без права"))
	})

	t.Run("админ с can_delete_messages удаляет чужое у всех", func(t *testing.T) {
		_, err := db.ExecContext(ctx, `
			UPDATE chats.members
			SET permissions = '{"can_delete_messages": true}'::jsonb
			WHERE chat_id = $1 AND user_id = $2
		`, groupID, admin)
		require.NoError(t, err)
		id := send(groupID, member, "с правом")
		_, err = chats.DeleteMessages(ctx, admin, groupID, []string{id}, true)
		require.NoError(t, err)
		require.False(t, sees(member, groupID, "с правом"))
	})

	privateID, _, err := chats.CreatePrivate(ctx, owner, author)
	require.NoError(t, err)

	t.Run("событие только нужным получателям и только при изменении", func(t *testing.T) {
		for _, forEveryone := range []bool{false, true} {
			id := send(privateID, owner, "проверка события")
			ws := &recordingRealtime{}
			deleting := NewService(db, ws, nil)
			_, err := deleting.DeleteMessages(ctx, owner, privateID, []string{id, id}, forEveryone)
			require.NoError(t, err)
			require.Len(t, ws.broadcasts, 1)
			var event struct {
				Type       string   `json:"type"`
				MessageIDs []string `json:"messageIds"`
			}
			require.NoError(t, json.Unmarshal(ws.broadcasts[0].payload, &event))
			require.Equal(t, []string{id}, event.MessageIDs)
			if forEveryone {
				require.Equal(t, "messages_deleted", event.Type)
				require.Equal(t, privateID, ws.broadcasts[0].chatID)
				require.Empty(t, ws.broadcasts[0].exclude)
			} else {
				require.Equal(t, "messages_hidden", event.Type)
				require.Equal(t, owner, ws.broadcasts[0].chatID)
			}
			ws.broadcasts = nil
			_, err = deleting.DeleteMessages(ctx, owner, privateID, []string{id}, forEveryone)
			require.NoError(t, err)
			require.Empty(t, ws.broadcasts, "повтор не рассылает событие")
		}
	})

	t.Run("повтор удаления у всех уже удалённого — успех", func(t *testing.T) {
		id := send(privateID, owner, "уже удалено")
		_, err := chats.DeleteMessages(ctx, owner, privateID, []string{id}, true)
		require.NoError(t, err)
		_, err = chats.DeleteMessages(ctx, owner, privateID, []string{id}, true)
		require.NoError(t, err)
	})

	t.Run("скрыть у себя уже удалённое у всех — успех", func(t *testing.T) {
		id := send(privateID, author, "удалено у всех")
		_, err := chats.DeleteMessages(ctx, owner, privateID, []string{id}, true)
		require.NoError(t, err)
		_, err = chats.DeleteMessages(ctx, owner, privateID, []string{id}, false)
		require.NoError(t, err)
	})

	t.Run("скрыты все сообщения — последнего нет и непрочитанных нет", func(t *testing.T) {
		chatID, _, err := chats.CreatePrivate(ctx, member, author)
		require.NoError(t, err)
		send(chatID, author, "первое")
		send(chatID, member, "второе")
		listed, err := chats.ListMessages(ctx, member, chatID, 50, 0)
		require.NoError(t, err)
		ids := make([]string, len(listed))
		for i, msg := range listed {
			ids[i] = msg.ID
		}
		last, err := chats.DeleteMessages(ctx, member, chatID, ids, false)
		require.NoError(t, err)
		require.Nil(t, last)
		chat, err := chats.Get(ctx, member, chatID)
		require.NoError(t, err)
		require.Nil(t, chat.LastMessage)
		require.Equal(t, 0, chat.UnreadCount)
	})

	t.Run("реакция и источник пересылки скрытого — не найдено", func(t *testing.T) {
		id := send(privateID, author, "скрытая реакция")
		_, err := chats.DeleteMessages(ctx, owner, privateID, []string{id}, false)
		require.NoError(t, err)
		_, _, _, err = chats.ToggleReaction(ctx, owner, id, "👍")
		require.ErrorIs(t, err, ErrNotFound)
		_, err = chats.ListReactions(ctx, owner, id)
		require.ErrorIs(t, err, ErrNotFound)
		_, err = chats.ForwardOrigin(ctx, owner, id)
		require.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("ответ удаления не раскрывает скрытый оригинал цитаты", func(t *testing.T) {
		for _, legacy := range []bool{false, true} {
			original := send(privateID, author, "скрытый оригинал")
			reply := send(privateID, author, "ответ на скрытое")
			_, err := db.ExecContext(ctx, `UPDATE messages.messages SET reply_to = $1 WHERE id = $2`, original, reply)
			require.NoError(t, err)
			_, err = chats.DeleteMessages(ctx, owner, privateID, []string{original}, false)
			require.NoError(t, err)
			latest := send(privateID, owner, "удалить последнее")
			var last *Message
			if legacy {
				last, err = chats.DeleteMessage(ctx, owner, latest)
			} else {
				last, err = chats.DeleteMessages(ctx, owner, privateID, []string{latest}, true)
			}
			require.NoError(t, err)
			require.NotNil(t, last)
			require.Equal(t, reply, last.ID)
			require.Nil(t, last.ReplyPreview, "legacy=%v", legacy)
			require.Empty(t, last.ReplySenderName)
		}
	})

	t.Run("прочтение скрытого не сдвигает границу", func(t *testing.T) {
		chatID, _, err := chats.CreatePrivate(ctx, admin, author)
		require.NoError(t, err)
		older := send(chatID, author, "старое")
		newer := send(chatID, author, "новое")
		_, err = chats.DeleteMessages(ctx, admin, chatID, []string{newer}, false)
		require.NoError(t, err)
		before, err := chats.Get(ctx, admin, chatID)
		require.NoError(t, err)
		require.Equal(t, 1, before.UnreadCount)
		require.Equal(t, older, before.LastMessage.ID)

		mark, err := chats.MarkMessagesRead(ctx, admin, chatID, []string{newer})
		require.NoError(t, err)
		require.Empty(t, mark.ReadIDs)
		after, err := chats.Get(ctx, admin, chatID)
		require.NoError(t, err)
		require.Equal(t, before.UnreadCount, after.UnreadCount)
		require.Equal(t, before.LastReadAt, after.LastReadAt)
	})
}
