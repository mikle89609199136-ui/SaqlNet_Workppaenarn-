package push

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Kind — вид уведомления. Текст по нему собирает service worker на языке
// получателя.
type Kind string

const (
	KindMessage    Kind = "message"
	KindCall       Kind = "call"
	KindMissedCall Kind = "missed_call"
)

const (
	queueSize      = 1024
	workers        = 4
	sendTimeout    = 10 * time.Second
	maxAttempts    = 3
	messageTTL     = 24 * 60 * 60 // сутки: пришедшее за ночь увидят утром
	callTTL        = 30           // звонок через минуту уже никому не нужен
	missedCallTTL  = 24 * 60 * 60
	payloadVersion = 1
)

// Event — что случилось. Кому и с какими именами — решает Notifier.
type Event struct {
	Kind     Kind
	ChatID   string
	ActorID  string // отправитель сообщения или звонящий
	CalleeID string // для входящего звонка — кому звонят; иначе все участники, кроме ActorID
	RoomID   string
	CallKind string
}

// Payload — содержимое push. Текста сообщения нет.
type Payload struct {
	V         int    `json:"v"`
	Kind      Kind   `json:"kind"`
	ChatID    string `json:"chatId"`
	ChatType  string `json:"chatType"`
	ChatTitle string `json:"chatTitle,omitempty"`
	ActorName string `json:"actorName"`
	RoomID    string `json:"roomId,omitempty"`
	CallKind  string `json:"callKind,omitempty"`
	Lang      string `json:"lang"`
}

// Target — подписка получателя, которому уведомления не выключены.
type Target struct {
	SubscriptionID string
	UserID         string
	Subscription   Subscription
	Lang           string
}

// ChatInfo — тип и название чата для подписи.
type ChatInfo struct {
	Type  string
	Title string
}

// Directory — всё, что Notifier узнаёт из базы.
type Directory interface {
	ChatInfo(ctx context.Context, chatID string) (ChatInfo, error)
	DisplayName(ctx context.Context, userID string) (string, error)
	IsMember(ctx context.Context, chatID, userID string) (bool, error)
	MembersExcept(ctx context.Context, chatID, userID string) ([]string, error)
	// Targets — подписки получателей, у которых уведомления включены.
	Targets(ctx context.Context, userIDs []string) ([]Target, error)
	DeleteSubscription(ctx context.Context, subscriptionID string) error
}

// Visibility — на каких устройствах приложение сейчас на экране: туда push
// не нужен, человек и так видит.
type Visibility interface {
	VisiblePushSubscriptions(userID string) map[string]bool
}

// Transport — отправка одного push. reason — почему push-сервис отказал
// (из тела ответа), для лога; при успехе пусто.
type Transport interface {
	Send(ctx context.Context, message []byte, sub Subscription, options SendOptions) (status int, reason string, err error)
}

type SendOptions struct {
	TTL     int
	Urgency webpush.Urgency
	Topic   string
}

// Config — ключи VAPID. Без них push выключен.
type Config struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

func (c Config) Enabled() bool { return c.PublicKey != "" && c.PrivateKey != "" }

// Notifier рассылает push в фоне: запрос, породивший событие, не ждёт.
// Очередь — в памяти: при перезапуске сервиса неотправленное теряется,
// а переполнение (всплеск) не тормозит отправку сообщений — лишнее
// отбрасывается с записью в лог.
type Notifier struct {
	directory  Directory
	visibility Visibility
	transport  Transport
	queue      chan Event
	wg         sync.WaitGroup
	retryDelay func(attempt int) time.Duration
}

// NewNotifier запускает воркеры. visibility может быть nil — тогда push
// уходит на все устройства.
func NewNotifier(ctx context.Context, directory Directory, visibility Visibility, transport Transport) *Notifier {
	n := &Notifier{
		directory:  directory,
		visibility: visibility,
		transport:  transport,
		queue:      make(chan Event, queueSize),
		retryDelay: func(attempt int) time.Duration { return time.Duration(attempt*attempt) * time.Second },
	}
	for i := 0; i < workers; i++ {
		n.wg.Add(1)
		go n.work(ctx)
	}
	return n
}

// Notify ставит событие в очередь. Nil-Notifier (push выключен) — ничего.
func (n *Notifier) Notify(event Event) {
	if n == nil {
		return
	}
	select {
	case n.queue <- event:
	default:
		slog.Warn("push queue is full, event dropped", "kind", event.Kind, "chatID", event.ChatID)
	}
}

// Wait дожидается воркеров после отмены контекста — для завершения и тестов.
func (n *Notifier) Wait() { n.wg.Wait() }

func (n *Notifier) work(ctx context.Context) {
	defer n.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-n.queue:
			n.deliver(ctx, event)
		}
	}
}

func (n *Notifier) recipients(ctx context.Context, event Event) ([]string, error) {
	switch event.Kind {
	case KindMessage:
		// Отправителя сообщения уже проверил сервис: писать может участник.
		return n.directory.MembersExcept(ctx, event.ChatID, event.ActorID)
	case KindMissedCall:
		// Комнату звонка создаёт клиент и сам называет чат: от имени не
		// участника пропущенного звонка быть не может.
		member, err := n.directory.IsMember(ctx, event.ChatID, event.ActorID)
		if err != nil || !member {
			return nil, err
		}
		return n.directory.MembersExcept(ctx, event.ChatID, event.ActorID)
	}
	// Звонок — только участнику того же чата, что и звонящий.
	for _, userID := range []string{event.ActorID, event.CalleeID} {
		member, err := n.directory.IsMember(ctx, event.ChatID, userID)
		if err != nil || !member {
			return nil, err
		}
	}
	return []string{event.CalleeID}, nil
}

func (n *Notifier) deliver(ctx context.Context, event Event) {
	recipients, err := n.recipients(ctx, event)
	if err != nil || len(recipients) == 0 {
		if err != nil {
			slog.Warn("push recipients", "kind", event.Kind, "err", err)
		}
		return
	}
	chat, err := n.directory.ChatInfo(ctx, event.ChatID)
	if err != nil {
		slog.Warn("push chat info", "chatID", event.ChatID, "err", err)
		return
	}
	actorName, err := n.directory.DisplayName(ctx, event.ActorID)
	if err != nil {
		slog.Warn("push actor name", "err", err)
		return
	}
	targets, err := n.directory.Targets(ctx, recipients)
	if err != nil {
		slog.Warn("push targets", "err", err)
		return
	}

	visible := map[string]map[string]bool{}
	options := optionsFor(event)
	for _, target := range targets {
		if n.visibility != nil {
			if _, ok := visible[target.UserID]; !ok {
				visible[target.UserID] = n.visibility.VisiblePushSubscriptions(target.UserID)
			}
			if visible[target.UserID][target.SubscriptionID] {
				continue
			}
		}
		payload := Payload{
			V:         payloadVersion,
			Kind:      event.Kind,
			ChatID:    event.ChatID,
			ChatType:  chat.Type,
			ActorName: actorName,
			RoomID:    event.RoomID,
			CallKind:  event.CallKind,
			Lang:      target.Lang,
		}
		if chat.Type != "private" {
			payload.ChatTitle = chat.Title
		}
		message, err := json.Marshal(payload)
		if err != nil {
			continue
		}
		n.send(ctx, event.Kind, target, message, options)
	}
}

func (n *Notifier) send(ctx context.Context, kind Kind, target Target, message []byte, options SendOptions) {
	// В лог — только push-сервис, не адрес подписки: в адресе — идентификатор
	// устройства.
	service := pushService(target.Subscription.Endpoint)
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		sendCtx, cancel := context.WithTimeout(ctx, sendTimeout)
		status, reason, err := n.transport.Send(sendCtx, message, target.Subscription, options)
		cancel()
		switch {
		case err == nil && status >= 200 && status < 300:
			return
		case status == http.StatusNotFound || status == http.StatusGone:
			// Подписки больше нет: удалили в браузере или она истекла.
			slog.Info("push subscription expired, deleted", "status", status, "service", service)
			if err := n.directory.DeleteSubscription(ctx, target.SubscriptionID); err != nil {
				slog.Warn("delete expired push subscription", "err", err)
			}
			return
		case err == nil && status != http.StatusTooManyRequests && status < 500:
			// Ошибка запроса (400, 403, 413) — повтор не поможет. Причина из
			// ответа — главное для разбора: 403 BadJwtToken у Apple — это
			// подпись VAPID, а не устройство.
			slog.Warn("push rejected", "status", status, "reason", reason, "service", service, "kind", kind)
			return
		}
		if attempt == maxAttempts {
			slog.Warn("push failed", "status", status, "reason", reason, "service", service, "kind", kind, "err", err)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(n.retryDelay(attempt)):
		}
	}
}

// topic сворачивает уведомления: новое по тому же чату или звонку
// заменяет ещё не доставленное. Не больше 32 символов base64url.
func topic(key string) string {
	sum := sha256.Sum256([]byte(key))
	return strings.TrimRight(base64.RawURLEncoding.EncodeToString(sum[:]), "=")[:32]
}

// optionsFor — срок жизни, приоритет и сворачивание push.
//
// Сообщения и входящий звонок — высокий приоритет. Apple переводит
// Urgency в приоритет APNs: normal — это «доставить с учётом батареи»,
// и заблокированный iPhone такие уведомления копит и придерживает — со
// стороны они «перестают приходить», как только телефон ушёл в сон.
// Видимое уведомление о сообщении — ровно тот случай, для которого
// высокий приоритет и предназначен. Пропущенный звонок подождёт.
func optionsFor(event Event) SendOptions {
	switch event.Kind {
	case KindCall:
		return SendOptions{TTL: callTTL, Urgency: webpush.UrgencyHigh, Topic: topic("call:" + event.RoomID)}
	case KindMissedCall:
		return SendOptions{TTL: missedCallTTL, Urgency: webpush.UrgencyNormal, Topic: topic("call:" + event.RoomID)}
	default:
		return SendOptions{TTL: messageTTL, Urgency: webpush.UrgencyHigh, Topic: topic("chat:" + event.ChatID)}
	}
}

// maxReasonBytes — столько тела ответа push-сервиса читаем ради причины отказа.
const maxReasonBytes = 512

// vapidSubscriber — контакт для подписи VAPID в том виде, какой ждёт
// webpush-go: адрес без «mailto:». Библиотека дописывает «mailto:» ко всему,
// что не начинается с «https:», и «mailto:admin@…» превращался в
// «mailto:mailto:admin@…» — такую подпись Apple отклоняет (403 BadJwtToken),
// и push на iPhone не доходили вовсе. Теперь годится любая запись.
func vapidSubscriber(subject string) string {
	subject = strings.TrimSpace(subject)
	if len(subject) >= len("mailto:") && strings.EqualFold(subject[:len("mailto:")], "mailto:") {
		subject = strings.TrimSpace(subject[len("mailto:"):])
	}
	return subject
}

// pushService — имя push-сервиса по адресу подписки, для лога.
func pushService(endpoint string) string {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

// rejectReason — причина отказа из ответа push-сервиса: у Apple это JSON
// {"reason":"BadJwtToken"}, у Google и Mozilla — текст.
func rejectReason(body io.Reader) string {
	raw, _ := io.ReadAll(io.LimitReader(body, maxReasonBytes))
	var apple struct {
		Reason string `json:"reason"`
	}
	if json.Unmarshal(raw, &apple) == nil && apple.Reason != "" {
		return apple.Reason
	}
	reason := strings.Join(strings.Fields(string(raw)), " ")
	if len(reason) > 200 {
		reason = reason[:200]
	}
	return strings.ToValidUTF8(reason, "")
}

// WebPushTransport — отправка через webpush-go с ключами VAPID.
type WebPushTransport struct {
	config Config
	client *http.Client
}

func NewWebPushTransport(config Config) *WebPushTransport {
	config.Subject = vapidSubscriber(config.Subject)
	return &WebPushTransport{
		config: config,
		client: &http.Client{
			Timeout: sendTimeout,
			// Push-сервисы не перенаправляют; перенаправление — повод не
			// идти дальше, а не следовать ему.
			CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") },
		},
	}
}

func (t *WebPushTransport) Send(ctx context.Context, message []byte, sub Subscription, options SendOptions) (int, string, error) {
	// Адрес проверен при записи; ещё раз — перед сетью.
	if err := sub.Validate(); err != nil {
		return http.StatusGone, "invalid subscription", nil
	}
	response, err := webpush.SendNotificationWithContext(ctx, message, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.Keys.P256dh, Auth: sub.Keys.Auth},
	}, &webpush.Options{
		HTTPClient:      t.client,
		Subscriber:      t.config.Subject,
		VAPIDPublicKey:  t.config.PublicKey,
		VAPIDPrivateKey: t.config.PrivateKey,
		TTL:             options.TTL,
		Urgency:         options.Urgency,
		Topic:           options.Topic,
	})
	if err != nil {
		return 0, "", err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response.StatusCode, "", nil
	}
	return response.StatusCode, rejectReason(response.Body), nil
}
