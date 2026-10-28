//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/stretchr/testify/require"
)

func TestMessageEditTimestampContract(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, ctx) })
	owner := seedUser(t, db, ctx)
	member := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "group", owner, map[string]string{owner: "owner", member: "member"})
	id := seedMessage(t, db, ctx, chatID, owner, "before")
	unchanged := seedMessage(t, db, ctx, chatID, owner, "unchanged")
	reply := seedMessage(t, db, ctx, chatID, owner, "reply")
	_, err := db.ExecContext(ctx, "UPDATE messages.messages SET reply_to=$1 WHERE id=$2", id, reply)
	require.NoError(t, err)
	ws := &personalPinRecorder{}
	service := chat.NewService(db, ws, nil)
	edit := func(messageID, content string) chat.Message {
		req := httptest.NewRequest(http.MethodPut, "/api/v2/messages/"+messageID, strings.NewReader(`{"content":"`+content+`"}`))
		req.SetPathValue("messageId", messageID)
		req = req.WithContext(authctx.WithUser(ctx, authctx.User{ID: owner}))
		w := httptest.NewRecorder()
		chat.NewHandler(service).EditMessage(w, req)
		require.Equal(t, 200, w.Code, w.Body.String())
		var msg chat.Message
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &msg))
		return msg
	}
	original := edit(unchanged, "unchanged")
	require.False(t, original.IsEdited)
	require.Equal(t, original.CreatedAt, original.UpdatedAt)
	require.Len(t, ws.chatEvents, 1)
	var unchangedEvent map[string]any
	require.NoError(t, json.Unmarshal(ws.chatEvents[0], &unchangedEvent))
	require.Equal(t, false, unchangedEvent["isEdited"])
	require.Equal(t, original.UpdatedAt, unchangedEvent["updatedAt"])
	ws.chatEvents = nil
	edited := edit(id, "after")
	require.True(t, edited.IsEdited)
	var stored time.Time
	require.NoError(t, db.QueryRowContext(ctx, "SELECT updated_at FROM messages.messages WHERE id=$1", id).Scan(&stored))
	require.Equal(t, stored.UTC().Format(time.RFC3339Nano), edited.UpdatedAt)
	require.Len(t, ws.chatEvents, 1)
	var event map[string]any
	require.NoError(t, json.Unmarshal(ws.chatEvents[0], &event))
	require.Equal(t, "message_edited", event["type"])
	require.Equal(t, true, event["isEdited"])
	require.Equal(t, edited.UpdatedAt, event["updatedAt"])
	require.Equal(t, edited.UpdatedAt, edit(id, "after").UpdatedAt)
	// Generic record updates must not mark an original as edited or move an edit clock.
	for _, messageID := range []string{id, unchanged} {
		_, err = db.ExecContext(ctx, `UPDATE messages.messages SET metadata='{"service":true}', updated_at=NOW()+interval '1 day' WHERE id=$1`, messageID)
		require.NoError(t, err)
	}
	plain := chat.NewService(db, nil, nil)
	require.NoError(t, plain.PinMessage(ctx, owner, chatID, id))
	require.NoError(t, plain.SetPersonalPin(ctx, owner, chatID, id, true))
	_, err = plain.ToggleFavorite(ctx, owner, id)
	require.NoError(t, err)
	pins, err := plain.ListPins(ctx, owner, chatID)
	require.NoError(t, err)
	require.Len(t, pins, 1)
	require.Equal(t, edited.UpdatedAt, pins[0].Message.UpdatedAt)
	personal, err := plain.ListPersonalPins(ctx, owner, chatID, "", 50)
	require.NoError(t, err)
	require.Len(t, personal.Pins, 1)
	require.Equal(t, edited.UpdatedAt, personal.Pins[0].Message.UpdatedAt)
	favorites, err := plain.ListFavorites(ctx, owner, 50, 0)
	require.NoError(t, err)
	require.Len(t, favorites, 1)
	require.Equal(t, edited.UpdatedAt, favorites[0].UpdatedAt)
	request := httptest.NewRequest(http.MethodGet, "/api/v2/chats/"+chatID+"/messages", nil)
	request.SetPathValue("chatId", chatID)
	request = request.WithContext(authctx.WithUser(ctx, authctx.User{ID: owner}))
	response := httptest.NewRecorder()
	chat.NewHandler(plain).ListMessages(response, request)
	require.Equal(t, 200, response.Code, response.Body.String())
	var body struct {
		Messages []chat.Message `json:"messages"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	history := body.Messages
	require.Len(t, history, 3)
	for _, msg := range history {
		switch msg.ID {
		case id:
			require.True(t, msg.IsEdited)
			require.Equal(t, edited.UpdatedAt, msg.UpdatedAt)
		case unchanged:
			require.False(t, msg.IsEdited)
			require.Equal(t, original.UpdatedAt, msg.UpdatedAt)
		case reply:
			require.NotNil(t, msg.ReplyPreview)
			require.Equal(t, edited.UpdatedAt, msg.ReplyPreview.UpdatedAt)
			require.NotNil(t, msg.ReplyPreview.IsEdited)
			require.True(t, *msg.ReplyPreview.IsEdited)
		}
	}
	// Formatting-only edits also advance the canonical clock.
	formatted, err := plain.EditMessage(ctx, owner, id, "after", chat.MessageEntities{{Type: "bold", Offset: 0, Length: 5}})
	require.NoError(t, err)
	require.True(t, formatted.IsEdited)
	before, err := time.Parse(time.RFC3339Nano, edited.UpdatedAt)
	require.NoError(t, err)
	after, err := time.Parse(time.RFC3339Nano, formatted.UpdatedAt)
	require.NoError(t, err)
	require.True(t, after.After(before))
	batch, err := plain.SendMessages(ctx, owner, chatID, []chat.OutgoingMessage{{Content: "one", Type: "text"}, {Content: "two", Type: "text"}})
	require.NoError(t, err)
	require.Len(t, batch, 2)
	for _, msg := range batch {
		require.False(t, msg.IsEdited)
		require.Equal(t, msg.CreatedAt, msg.UpdatedAt)
	}
}
