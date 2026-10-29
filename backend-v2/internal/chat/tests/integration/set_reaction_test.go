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
	migrationsql "craneapp/backend-v2/migrations"
	"github.com/stretchr/testify/require"
)

type reactionRecorder struct {
	mu     sync.Mutex
	events [][]byte
}

func (*reactionRecorder) CallRooms() *chat.CallRoomManager  { return nil }
func (*reactionRecorder) IsUserConnected(string) bool       { return false }
func (*reactionRecorder) BroadcastToUsers([]string, []byte) {}
func (r *reactionRecorder) BroadcastToChat(_ string, payload []byte, _ string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, payload)
}

func TestSetReactionDesiredState(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	user := seedUser(t, db, ctx)
	other := seedUser(t, db, ctx)
	outsider := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "private", user, map[string]string{user: "owner", other: "member"})
	messageID := seedMessage(t, db, ctx, chatID, user, "desired state")
	recorder := &reactionRecorder{}
	service := chat.NewService(db, recorder, nil)
	handler := chat.NewHandler(service)
	request := func(actor, method, suffix, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v2/messages/"+messageID+suffix, strings.NewReader(body))
		req = req.WithContext(authctx.WithUser(ctx, authctx.User{ID: actor}))
		w := httptest.NewRecorder()
		handler.Messages(w, req)
		return w
	}
	for _, tc := range []struct {
		body, current string
		count         int
	}{
		{`{"emoji":"👍"}`, "👍", 1},
		{`{"emoji":"👍"}`, "👍", 1},
		{`{"emoji":" ❤︎ "}`, "❤️", 1},
		{`{"emoji":"❤️"}`, "❤️", 1},
		{`{"emoji":null}`, "", 0},
		{`{"emoji":null}`, "", 0},
	} {
		w := request(user, http.MethodPut, "/reactions/me", tc.body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var result struct {
			CurrentEmoji string          `json:"currentEmoji"`
			Reactions    []chat.Reaction `json:"reactions"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, tc.current, result.CurrentEmoji)
		require.Len(t, result.Reactions, tc.count)
	}
	require.Len(t, recorder.events, 3, "repeated PUT must not broadcast a second change")
	for _, event := range recorder.events {
		var payload struct {
			Type      string           `json:"type"`
			ActorID   string           `json:"actorId"`
			Reactions []map[string]any `json:"reactions"`
		}
		require.NoError(t, json.Unmarshal(event, &payload))
		require.Equal(t, "reaction_updated", payload.Type)
		require.Equal(t, user, payload.ActorID)
		for _, reaction := range payload.Reactions {
			require.NotContains(t, reaction, "myReaction")
		}
	}
	for _, body := range []string{`{}`, `{"emoji":""}`, `{"emoji":"   "}`, `{"emoji":"not-emoji"}`, `{"emoji":1}`, `{"emoji":[]}`, `{"emoji":"👍🏽"}`} {
		require.Equal(t, http.StatusBadRequest, request(user, http.MethodPut, "/reactions/me", body).Code, body)
	}
	require.Equal(t, http.StatusForbidden, request(outsider, http.MethodPut, "/reactions/me", `{"emoji":null}`).Code)
	// PUT and both legacy spellings share the same lock and unique constraint.
	var wg sync.WaitGroup
	errors := make(chan error, 24)
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			emoji := "👍"
			var err error
			if i%2 == 0 {
				_, _, _, err = service.SetReaction(ctx, user, messageID, &emoji)
			} else {
				_, _, _, err = service.ToggleReaction(ctx, user, messageID, "🔥")
			}
			errors <- err
		}(i)
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	for _, suffix := range []string{"/react", "/reactions"} {
		require.Equal(t, http.StatusOK, request(user, http.MethodPost, suffix, `{"emoji":"❤️"}`).Code)
	}
	var count int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.reactions WHERE message_id=$1 AND user_id=$2`, messageID, user).Scan(&count))
	require.LessOrEqual(t, count, 1)
	// Even a direct insert cannot violate the one-reaction rule.
	emoji := "👍"
	_, _, _, err := service.SetReaction(ctx, user, messageID, &emoji)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO messages.reactions(message_id,user_id,emoji) VALUES($1,$2,'🔥')`, messageID, user)
	require.Error(t, err)
	_, err = db.ExecContext(ctx, `UPDATE messages.messages SET deleted_at=NOW() WHERE id=$1`, messageID)
	require.NoError(t, err)
	require.Equal(t, http.StatusNotFound, request(user, http.MethodPut, "/reactions/me", `{"emoji":null}`).Code)
}

// Replay the existing migration only inside a rolled-back test transaction.
func TestReactionMigrationLegacyDuplicates(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	user := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "private", user, map[string]string{user: "owner"})
	messageID := seedMessage(t, db, ctx, chatID, user, "migration")
	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `ALTER TABLE messages.reactions DROP CONSTRAINT reactions_message_id_user_id_key`)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `INSERT INTO messages.reactions(message_id,user_id,emoji,created_at) VALUES($1,$2,'👍','2026-01-01'),($1,$2,'❤️','2026-01-02')`, messageID, user)
	require.NoError(t, err)
	migration, err := migrationsql.FS.ReadFile("0022_single_user_message_reaction.sql")
	require.NoError(t, err)
	for range 2 {
		_, err = tx.ExecContext(ctx, string(migration))
		require.NoError(t, err)
		var emoji string
		var count int
		require.NoError(t, tx.QueryRowContext(ctx, `SELECT MIN(emoji),COUNT(*) FROM messages.reactions WHERE message_id=$1 AND user_id=$2`, messageID, user).Scan(&emoji, &count))
		require.Equal(t, 1, count)
		require.Equal(t, "❤️", emoji)
	}
}
