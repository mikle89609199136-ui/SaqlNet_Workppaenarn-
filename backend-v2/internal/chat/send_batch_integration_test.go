//go:build integration

package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// Отправка пачкой на настоящей схеме (#808): порядок в ленте совпадает с
// порядком в пачке, а сбой одного сообщения не оставляет остальных.
func TestSendBatchOnRealSchema(t *testing.T) {
	const (
		sender = "33333333-3333-4333-8333-333333333333"
		peer   = "44444444-4444-4444-8444-444444444444"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, sender, "batch_sender")
	dbtest.User(t, db, peer, "batch_peer")
	chats := NewService(db, nil, nil)
	chatID, _, err := chats.CreatePrivate(ctx, sender, peer)
	require.NoError(t, err)

	batch := make([]OutgoingMessage, 20)
	for i := range batch {
		batch[i] = OutgoingMessage{Content: string(rune('a' + i)), Type: "text"}
	}

	sent, err := chats.SendMessages(ctx, sender, chatID, batch)
	require.NoError(t, err)
	require.Len(t, sent, len(batch))

	// Лента отдаёт сообщения по времени: пачка должна лечь ровно в своём
	// порядке, без перестановок из-за одинакового времени.
	listed, err := chats.ListMessages(ctx, peer, chatID, 50, 0)
	require.NoError(t, err)
	require.Len(t, listed, len(batch))
	for i, msg := range listed {
		require.Equal(t, batch[i].Content, msg.Content, "позиция %d", i)
	}

	var distinct int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT created_at) FROM messages.messages WHERE chat_id = $1`, chatID,
	).Scan(&distinct))
	require.Equal(t, len(batch), distinct, "у каждого сообщения пачки своё время")

	// Ответ на несуществующее сообщение во втором элементе: не пишется
	// и первый.
	missing := "55555555-5555-4555-8555-555555555555"
	_, err = chats.SendMessages(ctx, sender, chatID, []OutgoingMessage{
		{Content: "не должно остаться", Type: "text"},
		{Content: "ответ", Type: "text", ReplyTo: &missing},
	})
	var itemErr *MessageItemError
	require.True(t, errors.As(err, &itemErr), "ошибка должна называть сообщение: %v", err)
	require.Equal(t, 1, itemErr.Index)
	require.ErrorIs(t, err, ErrNotFound)

	var count int
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatID,
	).Scan(&count))
	require.Equal(t, len(batch), count, "неудачная пачка не должна оставить ни одного сообщения")
}
