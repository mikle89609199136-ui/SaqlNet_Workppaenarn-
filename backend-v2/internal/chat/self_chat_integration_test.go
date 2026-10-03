//go:build integration

package chat

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
	userservice "craneapp/backend-v2/internal/user"
)

// Saved Messages uses the normal chat/message/crypto paths, but has one owner,
// no peer and exactly one canonical row even when devices create it together.
func TestSelfChatOnRealSchema(t *testing.T) {
	const (
		userID = "71900000-0000-4000-8000-000000000010"
		peerID = "71900000-0000-4000-8000-000000000011"
	)
	db := dbtest.Postgres(t)
	dbtest.User(t, db, userID, "saved_messages_owner")
	dbtest.User(t, db, peerID, "saved_messages_peer")
	ctx := context.Background()
	realtime := &recordingRealtime{}
	chats := NewService(db, realtime, nil)
	pushed := &recordingPush{}
	chats.SetPush(pushed)

	const callers = 8
	ids := make([]string, callers)
	exists := make([]bool, callers)
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := range callers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ids[i], exists[i], errs[i] = chats.CreatePrivate(ctx, userID, userID)
		}(i)
	}
	wg.Wait()

	for _, err := range errs {
		require.NoError(t, err)
	}
	for _, id := range ids {
		require.Equal(t, ids[0], id)
	}
	created := 0
	for _, wasExisting := range exists {
		if !wasExisting {
			created++
		}
	}
	require.Equal(t, 1, created)

	var chatType, title string
	var memberCount int
	require.NoError(t, db.QueryRowContext(ctx, `
		SELECT c.type, c.title, COUNT(cm.user_id)
		FROM chats.chats c
		LEFT JOIN chats.members cm ON cm.chat_id = c.id
		WHERE c.id = $1
		GROUP BY c.id
	`, ids[0]).Scan(&chatType, &title, &memberCount))
	require.Equal(t, "self", chatType)
	require.Equal(t, savedMessagesTitle, title)
	require.Equal(t, 1, memberCount)

	listed, err := chats.List(ctx, userID, false)
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Equal(t, "self", listed[0].Type)
	require.Equal(t, savedMessagesTitle, listed[0].Title)
	require.Empty(t, listed[0].PeerID)
	require.False(t, listed[0].PeerIsOnline)
	require.Empty(t, listed[0].PeerLastSeen)

	keys := userservice.NewService(db)
	require.NoError(t, keys.SaveChatKeys(ctx, userID, ids[0], []userservice.ChatEncryptedKey{{
		UserID: userID, EncryptedKey: "wrapped-self-chat-key",
	}}, 1))
	key, err := keys.GetMyKey(ctx, userID, ids[0])
	require.NoError(t, err)
	require.Equal(t, "wrapped-self-chat-key", key.EncryptedKey)
	require.Equal(t, 1, key.KeyEpoch)

	sent, err := chats.SendMessages(ctx, userID, ids[0], []OutgoingMessage{{Content: "заметка", Type: "text"}})
	require.NoError(t, err)
	require.Len(t, sent, 1)
	require.Len(t, realtime.broadcasts, 1)
	require.Equal(t, userID, realtime.broadcasts[0].exclude, "self-chat must not notify the owner")
	require.Empty(t, pushed.events, "self-chat must not enqueue push notifications")
	messages, err := chats.ListMessages(ctx, userID, ids[0], 50, 0)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	require.Equal(t, "заметка", messages[0].Content)

	// Existing message features use the same paths in a self chat.
	replyTo := sent[0].ID
	replies, err := chats.SendMessages(ctx, userID, ids[0], []OutgoingMessage{{
		Content: "ответ", Type: "text", ReplyTo: &replyTo,
	}})
	require.NoError(t, err)
	require.Len(t, replies, 1)
	_, err = chats.EditMessage(ctx, userID, sent[0].ID, "обновлённая заметка", nil)
	require.NoError(t, err)
	status, _, _, err := chats.ToggleReaction(ctx, userID, sent[0].ID, "👍")
	require.NoError(t, err)
	require.Equal(t, StatusAdded, status)
	require.NoError(t, chats.PinMessage(ctx, userID, ids[0], sent[0].ID))
	pins, err := chats.ListPins(ctx, userID, ids[0])
	require.NoError(t, err)
	require.Len(t, pins, 1)

	// Forwarding keeps server-verified origin metadata; encrypted content is
	// supplied for the target chat by the client, as in every other chat.
	sourceChatID, _, err := chats.CreatePrivate(ctx, userID, peerID)
	require.NoError(t, err)
	sourceMessages, err := chats.SendMessages(ctx, userID, sourceChatID, []OutgoingMessage{{Content: "источник", Type: "text"}})
	require.NoError(t, err)
	origin, err := chats.ForwardOrigin(ctx, userID, sourceMessages[0].ID)
	require.NoError(t, err)
	metadata := map[string]any{}
	origin.Apply(metadata)
	forwarded, err := chats.SendMessages(ctx, userID, ids[0], []OutgoingMessage{{
		Content: "зашифровано ключом self-chat", Type: "text", Metadata: metadata,
	}})
	require.NoError(t, err)
	require.Len(t, forwarded, 1)
	require.True(t, forwarded[0].IsForwarded)
	require.Equal(t, sourceMessages[0].ID, forwarded[0].Metadata["forwardedFrom"])
}
