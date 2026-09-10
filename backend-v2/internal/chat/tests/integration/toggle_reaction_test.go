package integration

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"craneapp/backend-v2/internal/chat"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToggleReactionConcurrent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()

	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	defer db.Close()
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	require.NoError(t, db.PingContext(ctx))

	var constraintExists bool
	require.NoError(t, db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_constraint
			WHERE conname = 'reactions_message_id_user_id_key'
			  AND conrelid = 'messages.reactions'::regclass
		)
	`).Scan(&constraintExists))
	require.True(t, constraintExists, "migration 0022_single_user_message_reaction.sql is not applied")

	userID := randomUUID(t)
	messageID := randomUUID(t)
	chatID := randomUUID(t)
	username := "reaction_" + strings.ReplaceAll(userID, "-", "")

	_, err = db.ExecContext(ctx, `
		INSERT INTO auth.users (id, username, password_hash, first_name, last_name)
		VALUES ($1, $2, 'hashed_password', 'Test', 'User')
	`, userID, username)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM chats.chats WHERE id = $1`, chatID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM auth.users WHERE id = $1`, userID)
	})

	_, err = db.ExecContext(ctx, `
		INSERT INTO chats.chats (id, type, title, owner_id)
		VALUES ($1, 'private', 'test-chat', $2)
	`, chatID, userID)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO chats.members (user_id, chat_id)
		VALUES ($1, $2)
	`, userID, chatID)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO messages.messages (id, chat_id, content, sender_id, type)
		VALUES ($1, $2, 'test message', $3, 'text')
	`, messageID, chatID, userID)
	require.NoError(t, err)

	service := chat.NewService(db, nil)
	emojis := []string{"👍", "❤️"}
	statuses := make([]chat.ReactionStatus, len(emojis))
	errs := make([]error, len(emojis))
	start := make(chan struct{})

	var wg sync.WaitGroup
	for i, emoji := range emojis {
		wg.Add(1)
		go func(index int, selectedEmoji string) {
			defer wg.Done()
			<-start
			statuses[index], _, _, errs[index] = service.ToggleReaction(ctx, userID, messageID, selectedEmoji)
		}(i, emoji)
	}
	close(start)
	wg.Wait()

	require.NoError(t, errs[0])
	require.NoError(t, errs[1])
	assert.ElementsMatch(t,
		[]chat.ReactionStatus{chat.StatusAdded, chat.StatusReplaced},
		statuses,
	)

	var count int
	require.NoError(t, db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM messages.reactions
		WHERE message_id = $1 AND user_id = $2
	`, messageID, userID).Scan(&count))
	assert.Equal(t, 1, count)

	var finalEmoji string
	require.NoError(t, db.QueryRowContext(ctx, `
		SELECT emoji
		FROM messages.reactions
		WHERE message_id = $1 AND user_id = $2
	`, messageID, userID).Scan(&finalEmoji))
	assert.Contains(t, emojis, finalEmoji)
}

func randomUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	_, err := rand.Read(value[:])
	require.NoError(t, err)
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16],
	)
}
