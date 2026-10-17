//go:build integration

package chat

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Общее в переписке на настоящей схеме (#842): выдача по виду с курсором,
// без удалённых и скрытых, только участнику; позиция сообщения в ленте.
func TestSharedMediaOnRealSchema(t *testing.T) {
	const (
		me       = "d1111111-1111-4111-8111-111111111111"
		peer     = "d2222222-2222-4222-8222-222222222222"
		stranger = "d3333333-3333-4333-8333-333333333333"
		missing  = "d9999999-9999-4999-8999-999999999999"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, me, "shared_me")
	dbtest.User(t, db, peer, "shared_peer")
	dbtest.User(t, db, stranger, "shared_stranger")
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, me, peer)
	require.NoError(t, err)
	otherChat, _, err := chats.CreatePrivate(ctx, peer, stranger)
	require.NoError(t, err)

	// Сообщения вставляются напрямую: у вложений отправка требует настоящих
	// загрузок (#871), а здесь проверяется выдача, не отправка.
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seq := 0
	insert := func(chat, sender, kind string) string {
		t.Helper()
		seq++
		var id string
		require.NoError(t, db.QueryRow(`
			INSERT INTO messages.messages (chat_id, sender_id, content, type, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $5) RETURNING id::text
		`, chat, sender, fmt.Sprintf("%s %d", kind, seq), kind, base.Add(time.Duration(seq)*time.Minute)).Scan(&id))
		return id
	}
	ids := func(page SharedPage) []string {
		out := make([]string, len(page.Messages))
		for i, m := range page.Messages {
			out[i] = m.ID
		}
		return out
	}

	var photos []string // от старых к новым
	for i := 0; i < 5; i++ {
		photos = append(photos, insert(chatID, peer, "image"))
		insert(chatID, me, "text")
	}
	video := insert(chatID, me, "video")
	file := insert(chatID, peer, "file")
	audio := insert(chatID, me, "audio")
	insert(chatID, peer, "voice")
	insert(chatID, peer, "sticker")
	deleted := insert(chatID, peer, "image")
	_, err = db.Exec(`UPDATE messages.messages SET deleted_at = NOW() WHERE id = $1`, deleted)
	require.NoError(t, err)
	hidden := insert(chatID, peer, "image")
	_, err = db.Exec(`INSERT INTO messages.hidden_messages (user_id, message_id) VALUES ($1, $2)`, me, hidden)
	require.NoError(t, err)
	foreign := insert(otherChat, peer, "image")

	t.Run("медиа — фото и видео от новых к старым, без удалённых и скрытых у себя", func(t *testing.T) {
		page, err := chats.ListShared(ctx, me, chatID, "media", "", 30)
		require.NoError(t, err)
		want := []string{video, photos[4], photos[3], photos[2], photos[1], photos[0]}
		require.Equal(t, want, ids(page))
		require.Empty(t, page.NextCursor)
	})

	t.Run("скрытое у меня — видно собеседнику", func(t *testing.T) {
		page, err := chats.ListShared(ctx, peer, chatID, "media", "", 30)
		require.NoError(t, err)
		require.Contains(t, ids(page), hidden)
		require.NotContains(t, ids(page), deleted)
	})

	t.Run("файлы — файлы и аудио; голосовые и стикеры не попадают", func(t *testing.T) {
		page, err := chats.ListShared(ctx, me, chatID, "files", "", 30)
		require.NoError(t, err)
		require.Equal(t, []string{audio, file}, ids(page))
	})

	t.Run("текст — только текстовые", func(t *testing.T) {
		page, err := chats.ListShared(ctx, me, chatID, "text", "", 30)
		require.NoError(t, err)
		require.Len(t, page.Messages, 5)
		for _, m := range page.Messages {
			require.Equal(t, "text", m.Type)
		}
	})

	t.Run("курсор — страницы без пропусков и повторов", func(t *testing.T) {
		first, err := chats.ListShared(ctx, me, chatID, "media", "", 4)
		require.NoError(t, err)
		require.Equal(t, []string{video, photos[4], photos[3], photos[2]}, ids(first))
		require.Equal(t, photos[2], first.NextCursor)

		second, err := chats.ListShared(ctx, me, chatID, "media", first.NextCursor, 4)
		require.NoError(t, err)
		require.Equal(t, []string{photos[1], photos[0]}, ids(second))
		require.Empty(t, second.NextCursor)
	})

	t.Run("курсор из чужого чата или несуществующий — ErrInvalidCursor", func(t *testing.T) {
		_, err := chats.ListShared(ctx, me, chatID, "media", foreign, 10)
		require.ErrorIs(t, err, ErrInvalidCursor)
		_, err = chats.ListShared(ctx, me, chatID, "media", missing, 10)
		require.ErrorIs(t, err, ErrInvalidCursor)
	})

	t.Run("не участник — ErrForbidden, нет чата — ErrNotFound", func(t *testing.T) {
		_, err := chats.ListShared(ctx, stranger, chatID, "media", "", 10)
		require.ErrorIs(t, err, ErrForbidden)
		_, err = chats.ListShared(ctx, me, missing, "media", "", 10)
		require.ErrorIs(t, err, ErrNotFound)
		_, err = chats.MessagePosition(ctx, stranger, chatID, photos[0])
		require.ErrorIs(t, err, ErrForbidden)
	})

	t.Run("позиция — сколько видимых зрителю сообщений новее", func(t *testing.T) {
		position, err := chats.MessagePosition(ctx, me, chatID, photos[0])
		require.NoError(t, err)
		// После первого фото: 9 из пяти пар, видео, файл, аудио, голосовое,
		// стикер; удалённое и скрытое у меня не считаются.
		require.Equal(t, 14, position)

		peerPosition, err := chats.MessagePosition(ctx, peer, chatID, photos[0])
		require.NoError(t, err)
		require.Equal(t, 15, peerPosition, "собеседник видит и скрытое у меня")

		newest, err := chats.MessagePosition(ctx, me, chatID, insert(chatID, peer, "text"))
		require.NoError(t, err)
		require.Equal(t, 0, newest)
	})

	t.Run("позиция удалённого, скрытого и чужого — ErrMessageNotFound", func(t *testing.T) {
		for _, id := range []string{deleted, hidden, foreign, missing} {
			_, err := chats.MessagePosition(ctx, me, chatID, id)
			require.ErrorIs(t, err, ErrMessageNotFound, id)
		}
	})

	// Переход из «Избранного» к оригиналу (#1076): чат по id сообщения.
	t.Run("место сообщения — только участнику, без удалённых и скрытых у себя", func(t *testing.T) {
		location, err := chats.MessageLocation(ctx, me, photos[0])
		require.NoError(t, err)
		require.Equal(t, chatID, location)

		peerHidden, err := chats.MessageLocation(ctx, peer, hidden)
		require.NoError(t, err)
		require.Equal(t, chatID, peerHidden, "скрытое у меня собеседнику видно")

		peerForeign, err := chats.MessageLocation(ctx, peer, foreign)
		require.NoError(t, err)
		require.Equal(t, otherChat, peerForeign)

		// Один ответ на все «нельзя»: по нему не узнать о чужих сообщениях.
		for _, id := range []string{deleted, hidden, foreign, missing} {
			_, err := chats.MessageLocation(ctx, me, id)
			require.ErrorIs(t, err, ErrMessageNotFound, id)
		}
		_, err = chats.MessageLocation(ctx, stranger, photos[0])
		require.ErrorIs(t, err, ErrMessageNotFound)
	})

}
