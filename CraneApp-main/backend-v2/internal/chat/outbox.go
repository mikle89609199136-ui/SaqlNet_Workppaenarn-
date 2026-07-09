package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net"
	"time"
)

// NATSConn is a minimal interface for publishing to NATS.
// Only used when NATS_URL is set; otherwise events are logged.
type NATSConn interface {
	Publish(subject string, data []byte) error
	Close()
}

// OutboxRelay polls messages.outbox and publishes unpublished events.
// It runs as a background goroutine and stops when ctx is cancelled.
func OutboxRelay(ctx context.Context, db *sql.DB, nats NATSConn) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := publishPending(ctx, db, nats); err != nil {
				slog.Error("outbox relay", "err", err)
			}
		}
	}
}

func publishPending(ctx context.Context, db *sql.DB, nats NATSConn) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id::text, aggregate_type, aggregate_id::text, event_type, payload, COALESCE(trace_id,'')
		FROM messages.outbox
		WHERE published_at IS NULL
		ORDER BY occurred_at
		LIMIT 100
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type event struct {
		id            string
		aggregateType string
		aggregateID   string
		eventType     string
		payload       json.RawMessage
		traceID       string
	}

	var events []event
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.id, &e.aggregateType, &e.aggregateID, &e.eventType, &e.payload, &e.traceID); err != nil {
			return err
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, e := range events {
		subject := "crane.events." + e.aggregateType + "." + e.eventType
		envelope, _ := json.Marshal(map[string]any{
			"event_id":       e.id,
			"event_type":     e.eventType,
			"aggregate_type": e.aggregateType,
			"aggregate_id":   e.aggregateID,
			"trace_id":       e.traceID,
			"occurred_at":    time.Now().UTC().Format(time.RFC3339Nano),
			"payload":        e.payload,
		})

		if nats != nil {
			if err := nats.Publish(subject, envelope); err != nil {
				slog.Error("outbox relay: publish", "subject", subject, "err", err)
				continue // do NOT mark as published; retry on next tick
			}
		} else {
			// No NATS configured — log the event for observability but do not mark
			// as published so the outbox stays intact until NATS becomes available.
			slog.Info("outbox relay [no-nats]", "subject", subject, "payload", string(envelope))
			continue
		}

		if _, err := db.ExecContext(ctx, `UPDATE messages.outbox SET published_at = NOW() WHERE id = $1`, e.id); err != nil {
			slog.Error("outbox relay: mark published", "id", e.id, "err", err)
		}
	}
	return nil
}

// natsConn wraps a raw TCP connection to NATS using the minimal text protocol.
// This avoids adding the nats.go client as a dependency.
type natsConn struct {
	conn net.Conn
}

func DialNATS(url string) (NATSConn, error) {
	addr := url
	// strip nats:// prefix
	if len(addr) > 7 && addr[:7] == "nats://" {
		addr = addr[7:]
	}
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return nil, err
	}
	// read INFO line
	buf := make([]byte, 1024)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Read(buf); err != nil {
		conn.Close()
		return nil, err
	}
	conn.SetReadDeadline(time.Time{})
	// send CONNECT
	if _, err := conn.Write([]byte("CONNECT {}\r\n")); err != nil {
		conn.Close()
		return nil, err
	}
	return &natsConn{conn: conn}, nil
}

func (n *natsConn) Publish(subject string, data []byte) error {
	msg := []byte("PUB " + subject + " " + itoa(len(data)) + "\r\n")
	msg = append(msg, data...)
	msg = append(msg, '\r', '\n')
	_, err := n.conn.Write(msg)
	return err
}

func (n *natsConn) Close() { n.conn.Close() }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
