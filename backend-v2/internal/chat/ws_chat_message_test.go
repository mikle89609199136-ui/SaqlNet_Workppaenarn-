package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const (
	senderUUID = "550e8400-e29b-41d4-a716-496655440001"
	chatUUID   = "550e8400-e29b-41d4-a716-496655440002"
)

// mockMessageSender фиксирует вызовы SendMessage и возвращает заготовленный результат.
type mockMessageSender struct {
	called   bool
	userID   string
	chatID   string
	content  string
	msgType  string
	replyTo  *string
	metadata map[string]any
	msg      chat.Message
	err      error
}

func (m *mockMessageSender) SendMessage(_ context.Context, userID, chatID, content, msgType string, replyTo *string, metadata map[string]any) (chat.Message, error) {
	m.called = true
	m.userID, m.chatID, m.content, m.msgType = userID, chatID, content, msgType
	m.replyTo, m.metadata = replyTo, metadata
	return m.msg, m.err
}

func newTestWSWithSender(t *testing.T, db *sql.DB, svc *mockMessageSender) (*chat.WSServer, *chat.Client) {
	t.Helper()
	ws := chat.NewWSServer(db, nil)
	ws.SetService(svc)
	client := &chat.Client{UserID: senderUUID, Send: make(chan []byte, 1)}
	return ws, client
}

// TestHandleChatMessage_MutedMember проверяет, что muted-участник не может
// отправить сообщение через WS: Service.SendMessage возвращает ErrMemberMuted,
// а отправитель получает фрейм chat_message_error с кодом member_muted
// (регрессия CHAT-B011: раньше WS-path вставлял сообщение напрямую в обход mute-проверки).
func TestHandleChatMessage_MutedMember(t *testing.T) {
	svc := &mockMessageSender{err: chat.ErrMemberMuted}
	ws, client := newTestWSWithSender(t, nil, svc)

	ws.HandleChatMessage(client, map[string]any{
		"chatId":  chatUUID,
		"content": "ws-muted-bypass",
	})
	require.True(t, svc.called)
	select {
	case frame := <-client.Send:
		var got map[string]any
		require.NoError(t, json.Unmarshal(frame, &got))
		require.Equal(t, "chat_message_error", got["type"])
		require.Equal(t, "member_muted", got["code"])
		require.Equal(t, chatUUID, got["chatId"])
	case <-time.After(time.Second):
		t.Fatal("ожидали фрейм chat_message_error отправителю")
	}
}
