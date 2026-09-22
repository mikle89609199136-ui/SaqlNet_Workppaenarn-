package integration

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/chat"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestSendMessageRejectsReplyFromAnotherChat(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}

	ctx := context.Background()
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, db.PingContext(ctx))

	senderID := randomUUID(t)
	memberID := randomUUID(t)
	outsiderID := randomUUID(t)
	chatAID := randomUUID(t)
	chatBID := randomUUID(t)
	replyID := randomUUID(t)
	prefix := strings.ReplaceAll(senderID, "-", "")

	_, err = db.ExecContext(ctx, `
		INSERT INTO auth.users (id, username, password_hash, first_name, last_name)
		VALUES
			($1, $4, 'hashed_password', 'Sender', 'User'),
			($2, $5, 'hashed_password', 'Member', 'User'),
			($3, $6, 'hashed_password', 'Outsider', 'User')
	`, senderID, memberID, outsiderID, "reply_sender_"+prefix, "reply_member_"+prefix, "reply_outsider_"+prefix)
	require.NoError(t, err)

	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM chats.chats WHERE id IN ($1, $2)`, chatAID, chatBID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM auth.users WHERE id IN ($1, $2, $3)`, senderID, memberID, outsiderID)
	})

	_, err = db.ExecContext(ctx, `
		INSERT INTO chats.chats (id, type, title, owner_id)
		VALUES ($1, 'group', 'Chat A', $3), ($2, 'group', 'Chat B', $3)
	`, chatAID, chatBID, senderID)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO chats.members (user_id, chat_id)
		VALUES ($1, $3), ($2, $3), ($1, $4), ($5, $4)
	`, senderID, memberID, chatAID, chatBID, outsiderID)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO messages.messages (id, chat_id, sender_id, content, type)
		VALUES ($1, $2, $3, 'private message in Chat A', 'text')
	`, replyID, chatAID, memberID)
	require.NoError(t, err)

	var before int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatBID).Scan(&before))

	_, err = chat.NewService(db, nil).SendMessage(ctx, senderID, chatBID, "cross-chat reply", "text", &replyID, nil)
	require.True(t, errors.Is(err, chat.ErrNotFound), "expected ErrNotFound, got %v", err)

	var after int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.messages WHERE chat_id = $1`, chatBID).Scan(&after))
	require.Equal(t, before, after, "invalid reply must not create a message in Chat B")
}
