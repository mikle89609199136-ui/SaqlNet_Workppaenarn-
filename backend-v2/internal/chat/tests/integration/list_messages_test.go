//go:build integration

package integration

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestListMessages_Integration проверяет сценарии ListMessages на реальной базе данных:
// 404 ErrNotFound для несуществующего чата, 403 ErrForbidden для не-участника
// и успешное чтение сообщений участником чата.
func TestListMessages_Integration(t *testing.T) {
	db := setupPostgres(t)
	ownerID := seedUser(t, db, "owner")
	memberID := seedUser(t, db, "member")
	outsiderID := seedUser(t, db, "outsider")
	chatID := seedGroupChat(t, db, ownerID, memberID)
	nonExistentChatID := randomUUID(t)
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `
      INSERT INTO messages.messages (chat_id, sender_id, content, type)
      VALUES ($1, $2, 'integration test message', 'text')
  `, chatID, ownerID)
	require.NoError(t, err)

	svc := chat.NewService(db, nil, nil)

	_, err = svc.ListMessages(ctx, memberID, nonExistentChatID, 50, 0)
	require.ErrorIs(t, err, chat.ErrNotFound)
	_, err = svc.ListMessages(ctx, outsiderID, chatID, 50, 0)
	require.ErrorIs(t, err, chat.ErrForbidden)
	msgs, err := svc.ListMessages(ctx, memberID, chatID, 50, 0)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Equal(t, "integration test message", msgs[0].Content)
}
