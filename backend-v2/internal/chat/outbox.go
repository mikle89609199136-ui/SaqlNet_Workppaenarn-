package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"
	"os"
	"fmt"

	"github.com/nats-io/nats.go"
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

// The official client supports authenticated cloud endpoints, TLS and reconnects.
type natsConn struct {
	conn *nats.Conn
}

func DialNATS(url string) (NATSConn, error) {
    opts := []nats.Option{
        nats.Timeout(5 * time.Second),
        nats.Name("craneapp-outbox"),
    }

    if creds := os.Getenv("NATS_CREDS"); creds != "" {
        opts = append(opts,
            nats.UserCredentialBytes([]byte(creds)),
        )
    }

    conn, err := nats.Connect(url, opts...)
    if err != nil {
        return nil, fmt.Errorf("connect to NATS: %w", err)
    }

    return &natsConn{conn: conn}, nil
}

func (n *natsConn) Publish(subject string, data []byte) error {
	if err := n.conn.Publish(subject, data); err != nil {
		return err
	}
	// Do not mark an outbox row as sent while it is only buffered locally.
	return n.conn.FlushTimeout(5 * time.Second)
}

func (n *natsConn) Close() { n.conn.Close() }
