package chat

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	typingChat  = "11111111-1111-4111-8111-111111111111"
	typingOther = "22222222-2222-4222-8222-222222222222"
)

type typingHarness struct {
	ws      *WSServer
	clients map[string]*Client
	loads   int
	members map[string]map[string]string
	now     time.Time
	mu      sync.Mutex
}

func newTypingHarness(t *testing.T, users ...string) *typingHarness {
	t.Helper()
	h := &typingHarness{
		clients: make(map[string]*Client),
		members: map[string]map[string]string{},
		now:     time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC),
	}
	h.ws = &WSServer{clients: make(map[string]map[*Client]bool)}
	h.ws.typingMembersLoader = func(_ context.Context, chatID string) (map[string]string, error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.loads++
		members, ok := h.members[chatID]
		if !ok {
			return nil, errors.New("chat not found")
		}
		copied := make(map[string]string, len(members))
		for id, name := range members {
			copied[id] = name
		}
		return copied, nil
	}
	h.ws.typingClock = func() time.Time {
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.now
	}
	for _, user := range users {
		client := &Client{UserID: user, Send: make(chan []byte, 16)}
		h.clients[user] = client
		h.ws.clients[user] = map[*Client]bool{client: true}
	}
	return h
}

func (h *typingHarness) advance(d time.Duration) {
	h.mu.Lock()
	h.now = h.now.Add(d)
	h.mu.Unlock()
}

func (h *typingHarness) setMembers(chatID string, members map[string]string) {
	h.mu.Lock()
	h.members[chatID] = members
	h.mu.Unlock()
}

func (h *typingHarness) loadCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.loads
}

// received — события, пришедшие пользователю, разобранные как JSON.
func (h *typingHarness) received(user string) []map[string]any {
	var events []map[string]any
	for {
		select {
		case raw := <-h.clients[user].Send:
			var event map[string]any
			if err := json.Unmarshal(raw, &event); err == nil {
				events = append(events, event)
			}
		default:
			return events
		}
	}
}

func TestTypingSendsOnlyServerFieldsWithFirstName(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})

	h.ws.handleTyping("igor", typingChat)

	events := h.received("masha")
	if len(events) != 1 {
		t.Fatalf("masha got %d events, want 1", len(events))
	}
	keys := make([]string, 0, len(events[0]))
	for key := range events[0] {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	want := []string{"chatId", "firstName", "senderId", "type", "userId"}
	if len(keys) != len(want) {
		t.Fatalf("event fields = %v, want exactly %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("event fields = %v, want exactly %v", keys, want)
		}
	}
	if events[0]["firstName"] != "Игорь" || events[0]["userId"] != "igor" || events[0]["type"] != "typing" {
		t.Fatalf("unexpected event %v", events[0])
	}
	if got := h.received("igor"); len(got) != 0 {
		t.Fatalf("typer must not receive own event, got %v", got)
	}
}

func TestTypingWarmCacheDoesNotTouchDatabase(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})

	for i := 0; i < 5; i++ {
		h.ws.handleTyping("igor", typingChat)
		h.ws.handleTyping("masha", typingChat)
		h.advance(1500 * time.Millisecond)
	}

	if got := h.loadCount(); got != 1 {
		t.Fatalf("members loaded %d times, want 1 (warm cache)", got)
	}
	if got := len(h.received("masha")); got != 5 {
		t.Fatalf("masha got %d events, want 5", got)
	}
}

func TestTypingCacheExpires(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})

	h.ws.handleTyping("igor", typingChat)
	h.advance(typingMembersTTL + time.Second)
	h.ws.handleTyping("igor", typingChat)

	if got := h.loadCount(); got != 2 {
		t.Fatalf("members loaded %d times, want 2 after TTL", got)
	}
}

func TestTypingNonMemberIsDropped(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha", "stranger")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})

	h.ws.handleTyping("stranger", typingChat)

	if got := h.received("masha"); len(got) != 0 {
		t.Fatalf("non-member typing reached members: %v", got)
	}
}

func TestTypingInvalidChatIDSkipsDatabase(t *testing.T) {
	h := newTypingHarness(t, "igor")

	h.ws.handleTyping("igor", "")
	h.ws.handleTyping("igor", "not-a-uuid")
	h.ws.handleTyping("igor", "'; DROP TABLE chats.members; --")

	if got := h.loadCount(); got != 0 {
		t.Fatalf("members loaded %d times for invalid chat ids, want 0", got)
	}
}

func TestTypingRateLimitPerChatAndPerUser(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})
	h.setMembers(typingOther, map[string]string{"igor": "Игорь", "masha": "Маша"})

	h.ws.handleTyping("igor", typingChat)
	h.advance(200 * time.Millisecond)
	h.ws.handleTyping("igor", typingChat) // тот же чат раньше секунды — отброшено
	if got := len(h.received("masha")); got != 1 {
		t.Fatalf("same chat within a second: masha got %d events, want 1", got)
	}

	h.ws.handleTyping("igor", typingOther) // другой чат, прошло 200 мс — можно
	h.ws.handleTyping("igor", typingOther) // сразу же — отброшено
	if got := len(h.received("masha")); got != 1 {
		t.Fatalf("other chat: masha got %d events, want 1", got)
	}

	h.advance(time.Second)
	h.ws.handleTyping("igor", typingChat)
	if got := len(h.received("masha")); got != 1 {
		t.Fatalf("after a second: masha got %d events, want 1", got)
	}
}

func TestTypingPerUserCapBlocksChatIDScan(t *testing.T) {
	h := newTypingHarness(t, "igor")
	// Перебор чужих chatId: в пределах 100 мс — только первый доходит до базы.
	for i := 0; i < 50; i++ {
		h.ws.handleTyping("igor", "33333333-3333-4333-8333-3333333333"+twoDigits(i))
	}
	if got := h.loadCount(); got != 1 {
		t.Fatalf("members loaded %d times during a chat id scan, want 1", got)
	}
}

func twoDigits(i int) string {
	return string([]byte{byte('0' + i/10), byte('0' + i%10)})
}

func TestTypingMembershipChangesApplyImmediately(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha", "newbie")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})
	h.ws.handleTyping("igor", typingChat)
	h.received("masha")

	// Вступил новичок, исключили Машу.
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "newbie": "Новичок"})
	h.ws.InvalidateChatMembers(typingChat)
	h.advance(time.Second)
	h.ws.handleTyping("igor", typingChat)

	if got := len(h.received("newbie")); got != 1 {
		t.Fatalf("joined member got %d events, want 1", got)
	}
	if got := h.received("masha"); len(got) != 0 {
		t.Fatalf("removed member still gets typing: %v", got)
	}
}

func TestTypingNameChangeInvalidatesCache(t *testing.T) {
	h := newTypingHarness(t, "igor", "masha")
	h.setMembers(typingChat, map[string]string{"igor": "Игорь", "masha": "Маша"})
	h.ws.handleTyping("igor", typingChat)
	h.received("masha")

	h.setMembers(typingChat, map[string]string{"igor": "Гоша", "masha": "Маша"})
	h.ws.InvalidateUserProfile("igor")
	h.advance(time.Second)
	h.ws.handleTyping("igor", typingChat)

	events := h.received("masha")
	if len(events) != 1 || events[0]["firstName"] != "Гоша" {
		t.Fatalf("after rename masha got %v, want firstName Гоша", events)
	}
}

func TestTypingCacheIgnoresLoadRacingWithInvalidation(t *testing.T) {
	now := time.Now()
	loads := 0
	var cache *typingMembersCache
	cache = newTypingMembersCache(func(context.Context, string) (map[string]string, error) {
		loads++
		if loads == 1 {
			// Состав меняется, пока идёт первая загрузка.
			cache.invalidateChat(typingChat)
			return map[string]string{"removed": "Старый"}, nil
		}
		return map[string]string{"igor": "Игорь"}, nil
	}, func() time.Time { return now })

	if _, err := cache.get(context.Background(), typingChat); err != nil {
		t.Fatal(err)
	}
	members, err := cache.get(context.Background(), typingChat)
	if err != nil {
		t.Fatal(err)
	}
	if _, stale := members["removed"]; stale || loads != 2 {
		t.Fatalf("stale load was cached: members=%v loads=%d", members, loads)
	}
}

// slowRowsDriver отдаёт строки участников по одной и ждёт сигнала перед
// второй — как lib/pq, который дочитывает строки из сети уже в rows.Next.
type slowRowsDriver struct {
	reading chan struct{} // закрывается, когда первая строка прочитана
	release chan struct{} // закрыть — отдать остальные строки
	ids     []string
}

func (d *slowRowsDriver) Open(string) (driver.Conn, error) { return slowRowsConn{d}, nil }

type slowRowsConn struct{ d *slowRowsDriver }

func (c slowRowsConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not supported") }
func (c slowRowsConn) Close() error                        { return nil }
func (c slowRowsConn) Begin() (driver.Tx, error)           { return nil, errors.New("not supported") }
func (c slowRowsConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "EXISTS") {
		return &existsRows{}, nil
	}
	return &slowRows{d: c.d}, nil
}

// existsRows — ответ «да» на проверку членства (если код её делает).
type existsRows struct{ done bool }

func (r *existsRows) Columns() []string { return []string{"exists"} }
func (r *existsRows) Close() error      { return nil }
func (r *existsRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = true
	return nil
}

type slowRows struct {
	d    *slowRowsDriver
	next int
}

func (r *slowRows) Columns() []string { return []string{"user_id"} }
func (r *slowRows) Close() error      { return nil }
func (r *slowRows) Next(dest []driver.Value) error {
	if r.next >= len(r.d.ids) {
		return io.EOF
	}
	if r.next == 1 {
		close(r.d.reading)
		<-r.d.release
	}
	dest[0] = r.d.ids[r.next]
	r.next++
	return nil
}

var slowDriverSeq int

// BroadcastToChat: ws.mu не держится, пока из базы читаются участники —
// подключения и отключения не ждут чужих запросов (#866).
func TestBroadcastToChatDoesNotHoldLockWhileReadingMembers(t *testing.T) {
	slow := &slowRowsDriver{reading: make(chan struct{}), release: make(chan struct{}), ids: []string{"sender", "masha"}}
	slowDriverSeq++
	name := "slowrows" + twoDigits(slowDriverSeq)
	sql.Register(name, slow)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	masha := &Client{UserID: "masha", Send: make(chan []byte, 1)}
	ws := &WSServer{db: db, clients: map[string]map[*Client]bool{"masha": {masha: true}}}

	done := make(chan struct{})
	go func() {
		ws.BroadcastToChat(typingChat, []byte(`{"type":"x"}`), "sender")
		close(done)
	}()
	select {
	case <-slow.reading:
	case <-time.After(2 * time.Second):
		t.Fatal("members were not read")
	}

	locked := make(chan struct{})
	go func() {
		// Писатель, как при подключении клиента.
		ws.mu.Lock()
		ws.clients["probe"] = map[*Client]bool{}
		delete(ws.clients, "probe")
		ws.mu.Unlock()
		close(locked)
	}()
	select {
	case <-locked:
	case <-time.After(300 * time.Millisecond):
		close(slow.release)
		t.Fatal("ws.mu is held while members are read from the database")
	}
	close(slow.release)

	<-done
	select {
	case <-masha.Send:
	default:
		t.Fatal("member did not receive the broadcast")
	}
}

func TestBroadcastToChatSkipsWhenSenderIsNotMember(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT user_id FROM chats.members WHERE chat_id = \$1`).
		WithArgs(typingChat).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("masha"))

	masha := &Client{UserID: "masha", Send: make(chan []byte, 1)}
	ws := &WSServer{db: db, clients: map[string]map[*Client]bool{"masha": {masha: true}}}
	ws.BroadcastToChat(typingChat, []byte(`{"type":"x"}`), "outsider")

	select {
	case got := <-masha.Send:
		t.Fatalf("broadcast from a non-member reached members: %s", got)
	default:
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
