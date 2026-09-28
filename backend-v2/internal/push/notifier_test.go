package push

import (
	"context"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type fakeDirectory struct {
	mu      sync.Mutex
	chats   map[string]ChatInfo
	names   map[string]string
	members map[string][]string
	targets map[string][]Target
	deleted []string
}

func (d *fakeDirectory) ChatInfo(_ context.Context, chatID string) (ChatInfo, error) {
	info, ok := d.chats[chatID]
	if !ok {
		return ChatInfo{}, errors.New("no chat")
	}
	return info, nil
}
func (d *fakeDirectory) DisplayName(_ context.Context, userID string) (string, error) {
	return d.names[userID], nil
}
func (d *fakeDirectory) IsMember(_ context.Context, chatID, userID string) (bool, error) {
	for _, member := range d.members[chatID] {
		if member == userID {
			return true, nil
		}
	}
	return false, nil
}
func (d *fakeDirectory) MembersExcept(_ context.Context, chatID, userID string) ([]string, error) {
	var out []string
	for _, member := range d.members[chatID] {
		if member != userID {
			out = append(out, member)
		}
	}
	return out, nil
}
func (d *fakeDirectory) Targets(_ context.Context, userIDs []string) ([]Target, error) {
	var out []Target
	for _, userID := range userIDs {
		out = append(out, d.targets[userID]...)
	}
	return out, nil
}
func (d *fakeDirectory) DeleteSubscription(_ context.Context, id string) error {
	d.mu.Lock()
	d.deleted = append(d.deleted, id)
	d.mu.Unlock()
	return nil
}

type fakeVisibility map[string]map[string]bool

func (v fakeVisibility) VisiblePushSubscriptions(userID string) map[string]bool { return v[userID] }

type sent struct {
	subscriptionEndpoint string
	payload              Payload
	options              SendOptions
}

type fakeTransport struct {
	mu       sync.Mutex
	sent     []sent
	statuses []int // по очереди на каждую попытку; кончились — 201
}

func (f *fakeTransport) Send(_ context.Context, message []byte, sub Subscription, options SendOptions) (int, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var payload Payload
	_ = json.Unmarshal(message, &payload)
	f.sent = append(f.sent, sent{sub.Endpoint, payload, options})
	status := http.StatusCreated
	if len(f.statuses) > 0 {
		status, f.statuses = f.statuses[0], f.statuses[1:]
	}
	return status, "", nil
}

func target(user, sub, lang string) Target {
	return Target{
		SubscriptionID: sub, UserID: user, Lang: lang,
		Subscription: Subscription{Endpoint: "https://fcm.googleapis.com/fcm/send/" + sub, Keys: validKeys()},
	}
}

func newDirectory() *fakeDirectory {
	return &fakeDirectory{
		chats: map[string]ChatInfo{
			"group":   {Type: "group", Title: "Команда"},
			"private": {Type: "private", Title: "Private chat"},
		},
		names: map[string]string{"igor": "Игорь", "masha": "Маша", "oleg": "Олег"},
		members: map[string][]string{
			"group":   {"igor", "masha", "oleg"},
			"private": {"igor", "masha"},
		},
		targets: map[string][]Target{
			"masha": {target("masha", "masha-phone", "ru"), target("masha", "masha-laptop", "ru")},
			"oleg":  {target("oleg", "oleg-phone", "en")},
			"igor":  {target("igor", "igor-phone", "ru")},
		},
	}
}

// deliverNow — событие напрямую, без очереди: тесты не ждут воркеров.
func deliverNow(n *Notifier, event Event) { n.deliver(context.Background(), event) }

func newTestNotifier(directory Directory, visibility Visibility, transport Transport) *Notifier {
	return &Notifier{directory: directory, visibility: visibility, transport: transport,
		queue: make(chan Event, 2), retryDelay: func(int) time.Duration { return 0 }}
}

func endpoints(list []sent) []string {
	out := make([]string, 0, len(list))
	for _, item := range list {
		out = append(out, item.subscriptionEndpoint[strings.LastIndex(item.subscriptionEndpoint, "/")+1:])
	}
	sort.Strings(out)
	return out
}

func TestMessagePushGoesToOtherMembersWithoutText(t *testing.T) {
	transport := &fakeTransport{}
	n := newTestNotifier(newDirectory(), nil, transport)

	deliverNow(n, Event{Kind: KindMessage, ChatID: "group", ActorID: "igor"})

	if got := endpoints(transport.sent); strings.Join(got, ",") != "masha-laptop,masha-phone,oleg-phone" {
		t.Fatalf("recipients = %v", got)
	}
	for _, item := range transport.sent {
		p := item.payload
		if p.Kind != KindMessage || p.ActorName != "Игорь" || p.ChatTitle != "Команда" || p.ChatType != "group" {
			t.Fatalf("payload = %+v", p)
		}
		if item.options.TTL != messageTTL || item.options.Topic == "" || len(item.options.Topic) > 32 {
			t.Fatalf("options = %+v", item.options)
		}
		// Высокий приоритет: с normal заблокированный iPhone придерживает
		// уведомления о сообщениях.
		if item.options.Urgency != webpush.UrgencyHigh {
			t.Fatalf("message urgency = %q, want high", item.options.Urgency)
		}
	}
	// Язык — получателя.
	for _, item := range transport.sent {
		if strings.HasSuffix(item.subscriptionEndpoint, "oleg-phone") && item.payload.Lang != "en" {
			t.Fatalf("oleg lang = %q", item.payload.Lang)
		}
	}
}

func TestPayloadHasOnlyKnownFields(t *testing.T) {
	message, _ := json.Marshal(Payload{V: 1, Kind: KindMessage, ChatID: "c", ChatType: "private", ActorName: "Игорь", Lang: "ru"})
	var fields map[string]any
	_ = json.Unmarshal(message, &fields)
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "actorName,chatId,chatType,kind,lang,v" {
		t.Fatalf("payload fields = %v", keys)
	}
}

func TestPrivateChatPushHasNoTitle(t *testing.T) {
	transport := &fakeTransport{}
	n := newTestNotifier(newDirectory(), nil, transport)
	deliverNow(n, Event{Kind: KindMessage, ChatID: "private", ActorID: "igor"})

	if len(transport.sent) != 2 || transport.sent[0].payload.ChatTitle != "" {
		t.Fatalf("sent = %+v", transport.sent)
	}
}

func TestVisibleDeviceIsSkippedOtherDevicesStillGetPush(t *testing.T) {
	transport := &fakeTransport{}
	visibility := fakeVisibility{"masha": {"masha-laptop": true}}
	n := newTestNotifier(newDirectory(), visibility, transport)

	deliverNow(n, Event{Kind: KindMessage, ChatID: "group", ActorID: "igor"})

	if got := endpoints(transport.sent); strings.Join(got, ",") != "masha-phone,oleg-phone" {
		t.Fatalf("recipients = %v", got)
	}
}

func TestCallPushOnlyToChatMemberCallee(t *testing.T) {
	transport := &fakeTransport{}
	n := newTestNotifier(newDirectory(), nil, transport)

	// Звонящий не участник чата — push нет.
	deliverNow(n, Event{Kind: KindCall, ChatID: "private", ActorID: "oleg", CalleeID: "masha", RoomID: "r1"})
	// Вызываемый не участник — push нет.
	deliverNow(n, Event{Kind: KindCall, ChatID: "private", ActorID: "igor", CalleeID: "oleg", RoomID: "r1"})
	if len(transport.sent) != 0 {
		t.Fatalf("push to non-members: %+v", transport.sent)
	}

	deliverNow(n, Event{Kind: KindCall, ChatID: "private", ActorID: "igor", CalleeID: "masha", RoomID: "r1", CallKind: "video"})
	if got := endpoints(transport.sent); strings.Join(got, ",") != "masha-laptop,masha-phone" {
		t.Fatalf("recipients = %v", got)
	}
	call := transport.sent[0]
	if call.options.TTL != callTTL || call.options.Urgency != webpush.UrgencyHigh || call.payload.CallKind != "video" {
		t.Fatalf("call = %+v", call)
	}

	// Пропущенный от не участника чата — push нет.
	transport.sent = nil
	deliverNow(n, Event{Kind: KindMissedCall, ChatID: "private", ActorID: "oleg", RoomID: "r2"})
	if len(transport.sent) != 0 {
		t.Fatalf("missed call from a non-member: %+v", transport.sent)
	}

	// Пропущенный — тот же Topic: заменяет входящий, если тот не доставлен.
	deliverNow(n, Event{Kind: KindMissedCall, ChatID: "private", ActorID: "igor", RoomID: "r1"})
	if len(transport.sent) != 2 || transport.sent[0].options.Topic != call.options.Topic {
		t.Fatalf("missed = %+v", transport.sent)
	}
}

func TestExpiredSubscriptionIsDeleted(t *testing.T) {
	directory := newDirectory()
	transport := &fakeTransport{statuses: []int{http.StatusGone}}
	n := newTestNotifier(directory, nil, transport)

	deliverNow(n, Event{Kind: KindMessage, ChatID: "private", ActorID: "masha"})

	if len(directory.deleted) != 1 || directory.deleted[0] != "igor-phone" {
		t.Fatalf("deleted = %v", directory.deleted)
	}
}

func TestRetriesOnServerErrorsButNotOnBadRequest(t *testing.T) {
	transport := &fakeTransport{statuses: []int{500, 503, 201}}
	n := newTestNotifier(newDirectory(), nil, transport)
	deliverNow(n, Event{Kind: KindMessage, ChatID: "private", ActorID: "masha"})
	if len(transport.sent) != 3 {
		t.Fatalf("attempts = %d, want 3 (two failures, then success)", len(transport.sent))
	}

	transport = &fakeTransport{statuses: []int{500, 500, 500, 500}}
	n = newTestNotifier(newDirectory(), nil, transport)
	deliverNow(n, Event{Kind: KindMessage, ChatID: "private", ActorID: "masha"})
	if len(transport.sent) != maxAttempts {
		t.Fatalf("attempts = %d, want %d", len(transport.sent), maxAttempts)
	}

	transport = &fakeTransport{statuses: []int{400}}
	directory := newDirectory()
	n = newTestNotifier(directory, nil, transport)
	deliverNow(n, Event{Kind: KindMessage, ChatID: "private", ActorID: "masha"})
	if len(transport.sent) != 1 || len(directory.deleted) != 0 {
		t.Fatalf("bad request: attempts %d, deleted %v", len(transport.sent), directory.deleted)
	}
}

func TestFullQueueDropsInsteadOfBlocking(t *testing.T) {
	n := newTestNotifier(newDirectory(), nil, &fakeTransport{})
	done := make(chan struct{})
	go func() {
		for i := 0; i < 10; i++ {
			n.Notify(Event{Kind: KindMessage, ChatID: "group", ActorID: "igor"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Notify blocked on a full queue")
	}

	var disabled *Notifier
	disabled.Notify(Event{Kind: KindMessage}) // push выключен — просто ничего
}

func TestNotifierWorkersDeliverQueuedEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	transport := &fakeTransport{}
	n := NewNotifier(ctx, newDirectory(), nil, transport)
	n.Notify(Event{Kind: KindMessage, ChatID: "private", ActorID: "masha"})

	deadline := time.After(2 * time.Second)
	for {
		transport.mu.Lock()
		count := len(transport.sent)
		transport.mu.Unlock()
		if count == 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("queued event was not delivered")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	n.Wait()
}

// Транспорт не идёт в сеть по адресу, не прошедшему проверку.
func TestWebPushTransportRefusesUnknownEndpoint(t *testing.T) {
	transport := NewWebPushTransport(Config{PublicKey: "x", PrivateKey: "y"})
	status, _, err := transport.Send(context.Background(), []byte("{}"),
		Subscription{Endpoint: "https://127.0.0.1:9/push", Keys: validKeys()}, SendOptions{TTL: 1})
	if err != nil || status != http.StatusGone {
		t.Fatalf("status %d, err %v; want refused as gone", status, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// deviceKeys — настоящие ключи устройства: webpush-go шифрует ими push.
func deviceKeys(t *testing.T) Keys {
	t.Helper()
	_, x, y, err := elliptic.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return Keys{
		P256dh: base64.RawURLEncoding.EncodeToString(elliptic.Marshal(elliptic.P256(), x, y)),
		Auth:   base64.RawURLEncoding.EncodeToString(auth),
	}
}

// sendThroughTransport — один push через настоящий транспорт с подменённой
// сетью: что ушло (заголовок подписи) и что сервис ответил.
func sendThroughTransport(t *testing.T, subject string, status int, body string) (string, int, string) {
	t.Helper()
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	transport := NewWebPushTransport(Config{PublicKey: publicKey, PrivateKey: privateKey, Subject: subject})
	var authorization string
	transport.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		authorization = r.Header.Get("Authorization")
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}
	gotStatus, reason, err := transport.Send(context.Background(), []byte(`{}`),
		Subscription{Endpoint: "https://web.push.apple.com/QGuQ", Keys: deviceKeys(t)}, SendOptions{TTL: 60})
	if err != nil {
		t.Fatal(err)
	}
	return authorization, gotStatus, reason
}

// jwtSubject — поле sub подписи VAPID из заголовка «vapid t=<jwt>, k=…».
func jwtSubject(t *testing.T, authorization string) string {
	t.Helper()
	token := strings.TrimPrefix(strings.SplitN(authorization, ",", 2)[0], "vapid t=")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("authorization = %q", authorization)
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	return claims.Sub
}

// Apple отклоняет подпись с «mailto:mailto:…» (403 BadJwtToken): контакт
// должен уходить ровно одним «mailto:», как бы его ни записали.
func TestVapidSubjectHasSingleMailto(t *testing.T) {
	cases := map[string]string{
		"mailto:admin@example.com":    "mailto:admin@example.com",
		"admin@example.com":           "mailto:admin@example.com",
		" MAILTO: admin@example.com ": "mailto:admin@example.com",
		"https://craneapp.example":    "https://craneapp.example",
	}
	for subject, want := range cases {
		authorization, _, _ := sendThroughTransport(t, subject, http.StatusCreated, "")
		if got := jwtSubject(t, authorization); got != want {
			t.Errorf("VAPID_SUBJECT %q → sub %q, want %q", subject, got, want)
		}
	}
}

// Отказ push-сервиса — с причиной: по одному коду 403 не понять, подпись
// это или устройство.
func TestRejectReasonFromPushService(t *testing.T) {
	_, status, reason := sendThroughTransport(t, "admin@example.com", http.StatusForbidden, `{"reason":"BadJwtToken"}`)
	if status != http.StatusForbidden || reason != "BadJwtToken" {
		t.Fatalf("apple: status %d, reason %q", status, reason)
	}
	_, _, reason = sendThroughTransport(t, "admin@example.com", http.StatusBadRequest, "  invalid\nJWT  provided ")
	if reason != "invalid JWT provided" {
		t.Fatalf("text: reason %q", reason)
	}
	_, _, reason = sendThroughTransport(t, "admin@example.com", http.StatusCreated, `{"reason":"ignored"}`)
	if reason != "" {
		t.Fatalf("success: reason %q, want empty", reason)
	}
}

// В лог отказа — причина, push-сервис и вид события; адреса подписки нет.
func TestRejectedPushIsLoggedWithReasonAndService(t *testing.T) {
	var logs strings.Builder
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(previous)

	transport := &reasonTransport{status: http.StatusForbidden, reason: "BadJwtToken"}
	n := newTestNotifier(newDirectory(), nil, transport)
	deliverNow(n, Event{Kind: KindMessage, ChatID: "private", ActorID: "masha"})

	line := logs.String()
	for _, want := range []string{"push rejected", "status=403", "reason=BadJwtToken", "service=fcm.googleapis.com", "kind=message"} {
		if !strings.Contains(line, want) {
			t.Errorf("log %q has no %q", line, want)
		}
	}
	if strings.Contains(line, "igor-phone") {
		t.Errorf("log leaks the subscription endpoint: %q", line)
	}
}

type reasonTransport struct {
	status int
	reason string
}

func (r *reasonTransport) Send(context.Context, []byte, Subscription, SendOptions) (int, string, error) {
	return r.status, r.reason, nil
}
