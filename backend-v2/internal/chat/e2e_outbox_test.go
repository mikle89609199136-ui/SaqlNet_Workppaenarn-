package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

type protocolNATS struct {
	subject string
	data    []byte
}

func (n *protocolNATS) Publish(subject string, data []byte) error {
	n.subject = subject
	n.data = append([]byte(nil), data...)
	return nil
}
func (*protocolNATS) Close() {}

func TestE2EOutboxPreservesCiphertextAndMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	content := `{"v":3, "e2e":true,"epoch":7,"iv":"AAECAwQFBgcICQoL","data":"a+/==","kid":"fp","sig":"s+/=="}`
	payload, err := json.Marshal(map[string]any{
		"content": content, "replyTo": "reply-id",
		"metadata": map[string]any{"mediaEncryption": map[string]any{"version": 2, "keyEpoch": 7, "iv": "iv+/=="}},
	})
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT id::text, aggregate_type`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "aggregate_type", "aggregate_id", "event_type", "payload", "trace_id"}).
			AddRow("event-id", "message", "message-id", "created", payload, "trace-id"))
	mock.ExpectExec(`UPDATE messages.outbox SET published_at`).WithArgs("event-id").WillReturnResult(sqlmock.NewResult(0, 1))
	nats := &protocolNATS{}
	require.NoError(t, publishPending(context.Background(), db, nats))
	require.Equal(t, "crane.events.message.created", nats.subject)
	var published struct {
		Payload json.RawMessage `json:"payload"`
	}
	require.NoError(t, json.Unmarshal(nats.data, &published))
	require.JSONEq(t, string(payload), string(published.Payload))
	var message struct {
		Content string `json:"content"`
	}
	require.NoError(t, json.Unmarshal(published.Payload, &message))
	require.Equal(t, content, message.Content)
	require.NoError(t, mock.ExpectationsWereMet())
}
