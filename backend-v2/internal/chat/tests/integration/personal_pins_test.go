//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/authctx"
	"github.com/stretchr/testify/require"
)

type personalPinRecorder struct {
	mu         sync.Mutex
	users      [][]string
	events     [][]byte
	chatEvents [][]byte
}

func (*personalPinRecorder) CallRooms() *chat.CallRoomManager { return nil }
func (*personalPinRecorder) IsUserConnected(string) bool      { return false }
func (r *personalPinRecorder) BroadcastToChat(_ string, payload []byte, _ string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.chatEvents = append(r.chatEvents, payload)
}
func (r *personalPinRecorder) BroadcastToUsers(users []string, payload []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.users = append(r.users, users)
	r.events = append(r.events, payload)
}

func TestPersonalPins(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	owner := seedUser(t, db, ctx)
	member := seedUser(t, db, ctx)
	stranger := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "group", owner, map[string]string{owner: "owner", member: "member"})
	messageID := seedMessage(t, db, ctx, chatID, owner, "personal pin")
	ws := &personalPinRecorder{}
	service := chat.NewService(db, ws, nil)
	require.NoError(t, service.SetPersonalPin(ctx, member, chatID, messageID, true))
	first, err := service.ListPersonalPins(ctx, member, chatID, "", 50)
	require.NoError(t, err)
	require.Len(t, first.Pins, 1)
	require.True(t, first.Pins[0].Message.IsPersonalPinned)
	require.False(t, first.Pins[0].Message.IsChatPinned)
	at := first.Pins[0].PinnedAt
	require.NoError(t, service.SetPersonalPin(ctx, member, chatID, messageID, true))
	repeated, err := service.ListPersonalPins(ctx, member, chatID, "", 50)
	require.NoError(t, err)
	require.Equal(t, at, repeated.Pins[0].PinnedAt)
	require.Len(t, ws.events, 1)
	require.Empty(t, ws.chatEvents)
	require.Equal(t, []string{member}, ws.users[0])
	var event map[string]any
	require.NoError(t, json.Unmarshal(ws.events[0], &event))
	require.Equal(t, "message_personal_pinned", event["type"])
	require.Equal(t, true, event["isPersonalPinned"])
	other, err := service.ListPersonalPins(ctx, owner, chatID, "", 50)
	require.NoError(t, err)
	require.Empty(t, other.Pins)
	require.ErrorIs(t, service.PinMessage(ctx, member, chatID, messageID), chat.ErrForbidden)
	require.NoError(t, service.PinMessage(ctx, owner, chatID, messageID))
	for _, viewer := range []string{member, owner} {
		messages, err := service.ListMessages(ctx, viewer, chatID, 50, 0)
		require.NoError(t, err)
		require.Len(t, messages, 1)
		require.True(t, messages[0].IsChatPinned)
		require.True(t, messages[0].IsPinned)
		require.Equal(t, viewer == member, messages[0].IsPersonalPinned)
	}
	require.NoError(t, service.SetPersonalPin(ctx, member, chatID, messageID, false))
	require.NoError(t, service.SetPersonalPin(ctx, member, chatID, messageID, false))
	require.Len(t, ws.events, 2)
	require.NoError(t, json.Unmarshal(ws.events[1], &event))
	require.Equal(t, "message_personal_unpinned", event["type"])
	require.ErrorIs(t, service.SetPersonalPin(ctx, stranger, chatID, messageID, true), chat.ErrForbidden)
	elsewhere := seedChat(t, db, ctx, "private", owner, map[string]string{owner: "owner", member: "member"})
	foreignMessage := seedMessage(t, db, ctx, elsewhere, owner, "other chat")
	require.ErrorIs(t, service.SetPersonalPin(ctx, member, chatID, foreignMessage, true), chat.ErrNotFound)
	// Scope errors are rejected without falling back to shared pins.
	handler := chat.NewHandler(service)
	for _, scope := range []string{"all", "unknown", "", "personal&scope=chat"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v2/chats/"+chatID+"/pins/"+messageID+"?scope="+scope, nil)
		req = req.WithContext(authctx.WithUser(ctx, authctx.User{ID: member}))
		w := httptest.NewRecorder()
		handler.Pins(w, req)
		require.Equal(t, 400, w.Code)
	}
	for _, method := range []string{http.MethodPost, http.MethodGet, http.MethodDelete} {
		path := "/api/v2/chats/" + chatID + "/pins"
		if method != http.MethodGet {
			path += "/" + messageID
		}
		path += "?scope=personal"
		req := httptest.NewRequest(method, path, nil)
		req = req.WithContext(authctx.WithUser(ctx, authctx.User{ID: member}))
		w := httptest.NewRecorder()
		handler.Pins(w, req)
		require.Equal(t, 200, w.Code, w.Body.String())
	}
}

func TestPersonalPinsPaginationAndCleanup(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	owner := seedUser(t, db, ctx)
	member := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "group", owner, map[string]string{owner: "owner", member: "member"})
	service := chat.NewService(db, nil, nil)
	ids := make([]string, 0, 3)
	for range 3 {
		id := seedMessage(t, db, ctx, chatID, owner, "page")
		ids = append(ids, id)
		require.NoError(t, service.SetPersonalPin(ctx, member, chatID, id, true))
	}
	_, err := db.ExecContext(ctx, `UPDATE messages.personal_pins SET pinned_at=$1 WHERE user_id=$2`, time.Now().UTC().Truncate(time.Microsecond), member)
	require.NoError(t, err)
	cursor := ""
	seen := map[string]bool{}
	var previous string
	for range 3 {
		page, err := service.ListPersonalPins(ctx, member, chatID, cursor, 1)
		require.NoError(t, err)
		require.Len(t, page.Pins, 1)
		id := page.Pins[0].MessageID
		require.False(t, seen[id])
		if previous != "" {
			require.Greater(t, previous, id)
		}
		previous = id
		seen[id] = true
		cursor = page.NextCursor
	}
	require.Empty(t, cursor)
	require.Len(t, seen, 3)
	_, err = service.ListPersonalPins(ctx, member, chatID, "invalid", 50)
	require.ErrorIs(t, err, chat.ErrInvalidInput)
	// Both soft and hard deletion clear storage, not just the visible list.
	_, err = service.DeleteMessage(ctx, owner, ids[0])
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM messages.messages WHERE id=$1`, ids[1])
	require.NoError(t, err)
	var count int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins WHERE user_id=$1`, member).Scan(&count))
	require.Equal(t, 1, count)
	require.NoError(t, service.LeaveChat(ctx, member, chatID))
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins WHERE user_id=$1`, member).Scan(&count))
	require.Zero(t, count)
	_, err = service.ListPersonalPins(ctx, member, chatID, "", 50)
	require.ErrorIs(t, err, chat.ErrForbidden)
	_, err = service.AddMember(ctx, owner, chatID, member)
	require.NoError(t, err)
	page, err := service.ListPersonalPins(ctx, member, chatID, "", 50)
	require.NoError(t, err)
	require.Empty(t, page.Pins)
	for _, ban := range []bool{false, true} {
		require.NoError(t, service.SetPersonalPin(ctx, member, chatID, ids[2], true))
		if ban {
			require.NoError(t, service.BanMember(ctx, owner, chatID, member, nil, "test"))
		} else {
			require.NoError(t, service.RemoveMember(ctx, owner, chatID, member))
		}
		require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins WHERE user_id=$1`, member).Scan(&count))
		require.Zero(t, count)
		if !ban {
			_, err = service.AddMember(ctx, owner, chatID, member)
			require.NoError(t, err)
		}
	}
}

func TestPersonalPinsCascadeUserAndChat(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	owner := seedUser(t, db, ctx)
	member := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "group", owner, map[string]string{owner: "owner", member: "member"})
	id := seedMessage(t, db, ctx, chatID, owner, "cascade")
	service := chat.NewService(db, nil, nil)
	require.NoError(t, service.SetPersonalPin(ctx, member, chatID, id, true))
	batchID := seedMessage(t, db, ctx, chatID, owner, "batch delete")
	require.NoError(t, service.SetPersonalPin(ctx, member, chatID, batchID, true))
	_, batchErr := service.DeleteMessages(ctx, owner, chatID, []string{batchID}, true)
	require.NoError(t, batchErr)
	var batchCount int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins WHERE message_id=$1`, batchID).Scan(&batchCount))
	require.Zero(t, batchCount)
	_, err := db.ExecContext(ctx, `DELETE FROM auth.users WHERE id=$1`, member)
	require.NoError(t, err)
	var count int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins`).Scan(&count))
	require.Zero(t, count)
	require.NoError(t, service.SetPersonalPin(ctx, owner, chatID, id, true))
	require.NoError(t, service.DeleteChat(ctx, owner, chatID))
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins`).Scan(&count))
	require.Zero(t, count)
}

func TestPersonalPinsConcurrentAddAndLeave(t *testing.T) {
	ctx := context.Background()
	db := TestDB
	t.Cleanup(func() { truncateTables(t, db, context.Background()) })
	owner := seedUser(t, db, ctx)
	member := seedUser(t, db, ctx)
	chatID := seedChat(t, db, ctx, "group", owner, map[string]string{owner: "owner", member: "member"})
	id := seedMessage(t, db, ctx, chatID, owner, "race")
	ws := &personalPinRecorder{}
	service := chat.NewService(db, ws, nil)
	start := make(chan struct{})
	results := make(chan error, 12)
	for range 12 {
		go func() { <-start; results <- service.SetPersonalPin(ctx, member, chatID, id, true) }()
	}
	close(start)
	for range 12 {
		require.NoError(t, <-results)
	}
	require.Len(t, ws.events, 1, "concurrent repeated adds emit one change")
	results = make(chan error, 2)
	go func() { results <- service.SetPersonalPin(ctx, member, chatID, id, true) }()
	go func() { results <- service.LeaveChat(ctx, member, chatID) }()
	for range 2 {
		err := <-results
		if err != nil {
			require.ErrorIs(t, err, chat.ErrForbidden)
		}
	}
	var count int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages.personal_pins WHERE user_id=$1`, member).Scan(&count))
	require.Zero(t, count)
	_, err := service.AddMember(ctx, owner, chatID, member)
	require.NoError(t, err)
	page, err := service.ListPersonalPins(ctx, member, chatID, "", 50)
	require.NoError(t, err)
	require.Empty(t, page.Pins)
}
