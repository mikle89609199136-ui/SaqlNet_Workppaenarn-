package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/lib/pq"
)

// Статусы доставки и прочтения (#657). У получателя в чате две границы в
// chats.user_chat_settings: «доставлено до» и «прочитано до» (#506). Каждый
// сдвиг границы пишется в журнал chats.receipt_marks; время доставки или
// прочтения сообщения — первый сдвиг границы другого участника, который
// его перешёл. Границы идут только вперёд, время ставит сервер.

const (
	ReceiptDelivered = "delivered"
	ReceiptRead      = "read"
)

// receiptColumns — граница получателя по виду отметки.
var receiptColumns = map[string]string{
	ReceiptDelivered: "last_delivered_at",
	ReceiptRead:      "last_read_at",
}

// ReceiptEvent — событие автору по сокету: граница получателя UserID в чате
// ChatID дошла до UpTo в момент At, его сообщения до UpTo включительно
// доставлены (Kind = delivered) или прочитаны (read).
type ReceiptEvent struct {
	Type   string `json:"type"`
	ChatID string `json:"chatId"`
	UserID string `json:"userId"`
	Kind   string `json:"kind"`
	UpTo   string `json:"upTo"`
	At     string `json:"at"`
}

// receiptShift — настоящий сдвиг границы, записанный в журнал.
type receiptShift struct {
	chatID   string
	chatType string
	userID   string
	kind     string
	upTo     time.Time
	at       time.Time
}

// receiptTime — время для клиента в UTC с миллисекундами. Формат Go
// отбрасывает лишние знаки, а не округляет: граница upTo не становится
// меньше времени сообщения, до которого она дошла.
func receiptTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// advanceReceipts сдвигает границы вида kind по source — запросу, который
// отдаёт (user_id, chat_id, up_to), по строке на пару «получатель — чат».
// Граница не идёт назад, повтор той же границы ничего не пишет; сдвиг и
// запись в журнал — одним запросом, возвращаются только настоящие сдвиги.
func advanceReceipts(ctx context.Context, q Querier, kind, source string, args ...any) ([]receiptShift, error) {
	column, ok := receiptColumns[kind]
	if !ok {
		return nil, fmt.Errorf("unknown receipt kind %q", kind)
	}
	rows, err := q.QueryContext(ctx, `
		WITH source (user_id, chat_id, up_to) AS (`+source+`),
		moved AS (
			INSERT INTO chats.user_chat_settings AS cs (user_id, chat_id, `+column+`)
			SELECT user_id, chat_id, up_to FROM source WHERE up_to IS NOT NULL
			ON CONFLICT (user_id, chat_id) DO UPDATE SET `+column+` = EXCLUDED.`+column+`
			WHERE cs.`+column+` IS NULL OR cs.`+column+` < EXCLUDED.`+column+`
			RETURNING cs.user_id, cs.chat_id, cs.`+column+` AS up_to
		)
		INSERT INTO chats.receipt_marks AS r (chat_id, user_id, kind, up_to, at)
		SELECT chat_id, user_id, '`+kind+`', up_to, NOW() FROM moved
		ON CONFLICT DO NOTHING
		RETURNING r.chat_id::text, r.user_id::text, r.up_to, r.at,
		          (SELECT c.type FROM chats.chats c WHERE c.id = r.chat_id)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var shifts []receiptShift
	for rows.Next() {
		shift := receiptShift{kind: kind}
		if err := rows.Scan(&shift.chatID, &shift.userID, &shift.upTo, &shift.at, &shift.chatType); err != nil {
			return nil, err
		}
		shifts = append(shifts, shift)
	}
	return shifts, rows.Err()
}

// advanceRead сдвигает «прочитано» и вместе с ним «доставлено» — прочитанное
// доставлено. Обе границы в одной транзакции, события — после фиксации.
func (s *Service) advanceRead(ctx context.Context, source string, args ...any) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	delivered, err := advanceReceipts(ctx, tx, ReceiptDelivered, source, args...)
	if err != nil {
		return err
	}
	read, err := advanceReceipts(ctx, tx, ReceiptRead, source, args...)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.publishReceipts(append(delivered, read...))
	return nil
}

// markDeliveredOnLoad — получатель загрузил список чатов (chatID пуст) или
// ленту чата: всё пришедшее ему до этого доставлено. Отметка — попутная:
// сбой не мешает загрузке, только пишется в лог.
func (s *Service) markDeliveredOnLoad(ctx context.Context, userID, chatID string) {
	var chat any
	if chatID != "" {
		chat = chatID
	}
	shifts, err := advanceReceipts(ctx, s.db, ReceiptDelivered, `
		SELECT cm.user_id, cm.chat_id, lm.created_at
		FROM chats.members cm
		JOIN LATERAL (
			SELECT m.created_at FROM messages.messages m
			WHERE m.chat_id = cm.chat_id AND m.deleted_at IS NULL
			  AND m.sender_id IS DISTINCT FROM cm.user_id
			ORDER BY m.created_at DESC
			LIMIT 1
		) lm ON TRUE
		LEFT JOIN chats.user_chat_settings cs ON cs.user_id = cm.user_id AND cs.chat_id = cm.chat_id
		WHERE cm.user_id = $1::uuid AND ($2::uuid IS NULL OR cm.chat_id = $2::uuid)
		  -- Только отставшие границы: остальные строки настроек не трогаются.
		  AND (cs.last_delivered_at IS NULL OR cs.last_delivered_at < lm.created_at)
	`, userID, chat)
	if err != nil {
		slog.WarnContext(ctx, "mark delivered on load failed", "error", err)
		return
	}
	s.publishReceipts(shifts)
}

// markDeliveredOnSend — отправка ушла в открытые сокеты получателей: для
// подключённых сейчас граница «доставлено» доходит до новых сообщений.
// Возвращает, сдвинулась ли хоть одна граница. Сбой — только в лог:
// сообщения уже отправлены.
func (s *Service) markDeliveredOnSend(ctx context.Context, chatID, senderID string, messageIDs []string) bool {
	if s.ws == nil || len(messageIDs) == 0 {
		return false
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT user_id::text FROM chats.members WHERE chat_id = $1 AND user_id <> $2
	`, chatID, senderID)
	if err != nil {
		slog.WarnContext(ctx, "mark delivered on send failed", "error", err)
		return false
	}
	var connected []string
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			continue
		}
		if s.ws.IsUserConnected(memberID) {
			connected = append(connected, memberID)
		}
	}
	failed := rows.Err()
	_ = rows.Close()
	if failed != nil {
		slog.WarnContext(ctx, "mark delivered on send failed", "error", failed)
		return false
	}
	if len(connected) == 0 {
		return false
	}
	shifts, err := advanceReceipts(ctx, s.db, ReceiptDelivered, `
		SELECT unnest($1::uuid[]), $2::uuid,
		       (SELECT MAX(m.created_at) FROM messages.messages m WHERE m.id = ANY($3::uuid[]))
	`, pq.Array(connected), chatID, pq.Array(messageIDs))
	if err != nil {
		slog.WarnContext(ctx, "mark delivered on send failed", "error", err)
		return false
	}
	s.publishReceipts(shifts)
	return len(shifts) > 0
}

// publishReceipts сообщает о сдвигах остальным участникам чата — авторам
// сообщений. Только личные чаты: в группах клиент пока показывает лишь
// «отправлено», а событие каждому участнику на каждое прочтение было бы
// лишней рассылкой; время в группах отдаётся в сообщениях.
func (s *Service) publishReceipts(shifts []receiptShift) {
	if s.ws == nil {
		return
	}
	for _, shift := range shifts {
		if shift.chatType != "private" {
			continue
		}
		payload, err := json.Marshal(ReceiptEvent{
			Type:   "receipts",
			ChatID: shift.chatID,
			UserID: shift.userID,
			Kind:   shift.kind,
			UpTo:   receiptTime(shift.upTo),
			At:     receiptTime(shift.at),
		})
		if err != nil {
			continue
		}
		s.ws.BroadcastToChat(shift.chatID, payload, shift.userID)
	}
}

// receiptTimes — время доставки и прочтения сообщения.
type receiptTimes struct {
	deliveredAt string
	readAt      string
}

// loadReceiptTimes — для каждого сообщения первый по времени сдвиг границы
// другого участника, перешедший его. Одним запросом на страницу: поиск по
// индексу (chat_id, kind, at) от времени сообщения до первого подходящего.
// Сдвиг не раньше сообщения: граница — время уже существующего сообщения
// или «сейчас», так что at >= up_to >= created_at.
func (s *Service) loadReceiptTimes(ctx context.Context, messageIDs []string) (map[string]receiptTimes, error) {
	times := make(map[string]receiptTimes, len(messageIDs))
	if len(messageIDs) == 0 {
		return times, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id::text,
		       (SELECT r.at FROM chats.receipt_marks r
		        WHERE r.chat_id = m.chat_id AND r.kind = 'delivered'
		          AND r.at >= m.created_at AND r.up_to >= m.created_at
		          AND r.user_id IS DISTINCT FROM m.sender_id
		        ORDER BY r.at LIMIT 1),
		       (SELECT r.at FROM chats.receipt_marks r
		        WHERE r.chat_id = m.chat_id AND r.kind = 'read'
		          AND r.at >= m.created_at AND r.up_to >= m.created_at
		          AND r.user_id IS DISTINCT FROM m.sender_id
		        ORDER BY r.at LIMIT 1)
		FROM messages.messages m
		WHERE m.id = ANY($1::uuid[]) AND m.deleted_at IS NULL
	`, pq.Array(messageIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var deliveredAt, readAt sql.NullTime
		if err := rows.Scan(&id, &deliveredAt, &readAt); err != nil {
			return nil, err
		}
		var t receiptTimes
		if deliveredAt.Valid {
			t.deliveredAt = receiptTime(deliveredAt.Time)
		}
		if readAt.Valid {
			t.readAt = receiptTime(readAt.Time)
		}
		times[id] = t
	}
	return times, rows.Err()
}

// hydrateMessagesReceipts — deliveredAt и readAt у своих сообщений зрителя.
func (s *Service) hydrateMessagesReceipts(ctx context.Context, viewerID string, messages []Message) error {
	var ids []string
	for i := range messages {
		if messages[i].SenderID == viewerID {
			ids = append(ids, messages[i].ID)
		}
	}
	times, err := s.loadReceiptTimes(ctx, ids)
	if err != nil {
		return err
	}
	for i := range messages {
		if t, ok := times[messages[i].ID]; ok && messages[i].SenderID == viewerID {
			messages[i].DeliveredAt = t.deliveredAt
			messages[i].ReadAt = t.readAt
		}
	}
	return nil
}

// hydrateChatsLastMessageReceipts — то же для последнего сообщения в списке
// чатов, если оно своё.
func (s *Service) hydrateChatsLastMessageReceipts(ctx context.Context, viewerID string, chats []Chat) error {
	var ids []string
	for i := range chats {
		if last := chats[i].LastMessage; last != nil && last.ID != "" && last.SenderID == viewerID {
			ids = append(ids, last.ID)
		}
	}
	times, err := s.loadReceiptTimes(ctx, ids)
	if err != nil {
		return err
	}
	for i := range chats {
		last := chats[i].LastMessage
		if last == nil || last.SenderID != viewerID {
			continue
		}
		if t, ok := times[last.ID]; ok {
			last.DeliveredAt = t.deliveredAt
			last.ReadAt = t.readAt
		}
	}
	return nil
}
