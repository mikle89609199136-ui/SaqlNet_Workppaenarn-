//go:build integration

package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/db/dbtest"
)

// «Печатает» на настоящей схеме (#866): имена из профиля и учётной
// записи, состав — из chats.members, исключённый сразу перестаёт получать.
func TestTypingOnRealSchema(t *testing.T) {
	const (
		owner    = "aaaaaaaa-1111-4111-8111-111111111111"
		named    = "bbbbbbbb-2222-4222-8222-222222222222"
		nameless = "cccccccc-3333-4333-8333-333333333333"
	)
	db := dbtest.Postgres(t)
	ctx := context.Background()
	dbtest.User(t, db, owner, "typing_owner")
	dbtest.User(t, db, named, "typing_named")
	dbtest.User(t, db, nameless, "typing_nameless")
	// Имя из профиля важнее имени учётной записи; пустое имя — username.
	_, err := db.Exec(`INSERT INTO users.profiles (user_id, first_name) VALUES ($1, 'Игорь')
	ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name`, named)
	require.NoError(t, err)
	_, err = db.Exec(`UPDATE auth.users SET first_name = '' WHERE id = $1`, nameless)
	require.NoError(t, err)

	ws := &WSServer{db: db, clients: make(map[string]map[*Client]bool)}
	chats := NewService(db, ws, nil)
	chatID, err := chats.CreateGroup(ctx, owner, "Typing", "", "", []string{named, nameless})
	require.NoError(t, err)

	members, err := ws.loadChatMembersForTyping(ctx, chatID)
	require.NoError(t, err)
	require.Equal(t, map[string]string{
		owner:    "typing_owner",
		named:    "Игорь",
		nameless: "typing_nameless",
	}, members)

	listen := func(user string) *Client {
		client := &Client{UserID: user, Send: make(chan []byte, 8)}
		ws.mu.Lock()
		ws.clients[user] = map[*Client]bool{client: true}
		ws.mu.Unlock()
		return client
	}
	ownerConn := listen(owner)
	namelessConn := listen(nameless)

	ws.handleTyping(named, chatID)
	var event map[string]any
	require.NoError(t, json.Unmarshal(<-ownerConn.Send, &event))
	require.Equal(t, "Игорь", event["firstName"])
	<-namelessConn.Send

	// Исключили — следующее «печатает» ему уже не приходит, без ожидания TTL.
	require.NoError(t, chats.RemoveMember(ctx, owner, chatID, nameless))
	for _, conn := range []*Client{ownerConn, namelessConn} {
		for len(conn.Send) > 0 {
			<-conn.Send // событие об исключении
		}
	}
	time.Sleep(typingMinInterval + 50*time.Millisecond)
	ws.handleTyping(named, chatID)
	require.Len(t, ownerConn.Send, 1)
	require.Len(t, namelessConn.Send, 0)
}
