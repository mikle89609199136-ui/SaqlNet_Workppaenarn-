//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"github.com/stretchr/testify/require"
)

// The server treats the client envelope as opaque content. Compare strings,
// rather than JSONEq: reserializing it must not change the stored wire value.
func TestE2EProtocolOpaqueTransport(t *testing.T) {
	const sender = "70700000-0000-4000-8000-000000000001"
	const peer = "70700000-0000-4000-8000-000000000002"
	db := dbtest.Postgres(t)
	dbtest.User(t, db, sender, "protocol_sender")
	dbtest.User(t, db, peer, "protocol_peer")
	ctx := context.Background()
	realtime := &recordingRealtime{}
	svc := NewService(db, realtime, nil)
	chatID, _, err := svc.CreatePrivate(ctx, sender, peer)
	require.NoError(t, err)
	handler := NewHandler(svc)
	envelopes := []string{
		`{"v":2, "e2e":true,"epoch":1,"iv":"AAECAwQFBgcICQoL","data":"a+/b==","kid":"fp1","sig":"s+/=="}`,
		`{"v":3,"e2e":true,"epoch":2,"iv":"AAECAwQFBgcICQoM","data":"Z+/c==","kid":"fp2","sig":"t+/=="}`,
	}
	var firstID string
	for _, content := range envelopes {
		item := map[string]any{"type": "text", "content": content}
		if firstID != "" {
			item["replyTo"] = firstID
		}
		body, err := json.Marshal(map[string]any{"messages": []any{item}})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+chatID, strings.NewReader(string(body)))
		req.SetPathValue("chatId", chatID)
		req = req.WithContext(authctx.WithUser(ctx, authctx.User{ID: sender}))
		rr := httptest.NewRecorder()
		handler.SendMessage(rr, req)
		require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
		var response struct {
			Messages []Message `json:"messages"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
		require.Len(t, response.Messages, 1)
		sent := response.Messages[0]
		require.Equal(t, content, sent.Content)
		if firstID == "" {
			firstID = sent.ID
		} else {
			require.Equal(t, firstID, *sent.ReplyTo)
		}
		var stored string
		require.NoError(t, db.QueryRowContext(ctx, `SELECT content FROM messages.messages WHERE id=$1`, sent.ID).Scan(&stored))
		require.Equal(t, content, stored)
		var event struct {
			Type    string  `json:"type"`
			Message Message `json:"message"`
		}
		require.NoError(t, json.Unmarshal(realtime.broadcasts[len(realtime.broadcasts)-1].payload, &event))
		require.Equal(t, "new_message", event.Type)
		require.Equal(t, content, event.Message.Content)
	}
	edited, err := svc.EditMessage(ctx, sender, firstID, envelopes[1], nil)
	require.NoError(t, err)
	require.Equal(t, envelopes[1], edited.Content)
	history, err := svc.ListMessages(ctx, peer, chatID, 50, 0)
	require.NoError(t, err)
	require.Len(t, history, 2)
	for _, message := range history {
		require.Equal(t, envelopes[1], message.Content)
	}
}
