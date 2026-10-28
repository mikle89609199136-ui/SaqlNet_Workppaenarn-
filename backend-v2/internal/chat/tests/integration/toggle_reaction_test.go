//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestToggleReactionConcurrent verifies that two concurrent ToggleReaction
// calls for the same (message, user) pair do not violate the unique
// constraint introduced by migration 0022_single_user_message_reaction.sql,
// and that exactly one reaction row remains afterwards.
//
// Uses the shared TestDB from TestMain; no per-test container is started.
func TestToggleReactionConcurrent(t *testing.T) {
	ctx := context.Background()
	db := TestDB

	t.Cleanup(func() {
		truncateTables(t, db, context.Background())
	})

	// Sanity check: the unique constraint from migration 0022 must exist.
	// Without it the guarantee under test is meaningless, and a passing
	// test would be misleading.
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

	// Seed a private chat owned by a single user, plus one message to react to.
	userID := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "private", userID, map[string]string{
		userID: "owner",
	})
	messageID := seedMessage(t, db, ctx, chatID, userID, "test message")

	service := chat.NewService(db, nil, nil)
	emojis := []string{"👍", "❤️"}
	statuses := make([]chat.ReactionStatus, len(emojis))
	errs := make([]error, len(emojis))
	start := make(chan struct{})

	var wg sync.WaitGroup
	for i, emoji := range emojis {
		wg.Add(1)
		go func(index int, selectedEmoji string) {
			defer wg.Done()
			// Block until both goroutines are ready to maximise the race window.
			<-start
			statuses[index], _, _, errs[index] = service.ToggleReaction(ctx, userID, messageID, selectedEmoji)
		}(i, emoji)
	}
	close(start)
	wg.Wait()

	require.NoError(t, errs[0])
	require.NoError(t, errs[1])

	// Exactly one call must add a new reaction and the other must replace it;
	// order is nondeterministic, hence ElementsMatch.
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
	assert.Equal(t, 1, count, "exactly one reaction row must survive concurrent toggles")

	var finalEmoji string
	require.NoError(t, db.QueryRowContext(ctx, `
		SELECT emoji
		FROM messages.reactions
		WHERE message_id = $1 AND user_id = $2
	`, messageID, userID).Scan(&finalEmoji))
	assert.Contains(t, emojis, finalEmoji, "surviving reaction must be one of the toggled emojis")
}

// Alternate presentations must share the same persisted group, and toggling
// through an alias must remove the existing reaction rather than replace it.
func TestToggleReactionCanonicalEmoji(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	first := seedUser(t, db, ctx)
	second := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "private", first, map[string]string{first: "owner", second: "member"})
	messageID := seedMessage(t, db, ctx, chatID, first, "canonical reaction")
	service := chat.NewService(db, nil, nil)
	for index, userID := range []string{first, second} {
		input := []string{" \u00a0❤\u3000", "❤︎"}[index]
		body, err := json.Marshal(map[string]string{"emoji": input})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+messageID+"/reactions", strings.NewReader(string(body)))
		req = req.WithContext(authctx.WithUser(ctx, authctx.User{ID: userID}))
		w := httptest.NewRecorder()
		chat.NewHandler(service).Messages(w, req)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var response struct {
			Action       chat.ReactionStatus `json:"action"`
			CurrentEmoji string              `json:"currentEmoji"`
			Reactions    []chat.Reaction     `json:"reactions"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, chat.StatusAdded, response.Action)
		require.Equal(t, "❤️", response.CurrentEmoji)
		require.Len(t, response.Reactions, 1)
		require.Equal(t, "❤️", response.Reactions[0].Emoji)
		require.Equal(t, index+1, response.Reactions[0].Count)
	}
	var groups int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT emoji) FROM messages.reactions WHERE message_id = $1`, messageID).Scan(&groups))
	require.Equal(t, 1, groups)
	status, current, reactions, err := service.ToggleReaction(ctx, first, messageID, "❤️")
	require.NoError(t, err)
	require.Equal(t, chat.StatusRemoved, status)
	require.Empty(t, current)
	require.Len(t, reactions, 1)
	require.Equal(t, 1, reactions[0].Count)
}
