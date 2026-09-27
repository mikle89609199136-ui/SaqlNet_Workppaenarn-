package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

type profileChangeBroadcaster struct {
	recipients []string
	payload    []byte
}

func (b *profileChangeBroadcaster) BroadcastToUsers(userIDs []string, message []byte) {
	b.recipients = append([]string(nil), userIDs...)
	b.payload = append([]byte(nil), message...)
}

func TestBroadcastProfileChangeNotifiesUserAndChatPeers(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT DISTINCT recipient_id::text`).
		WithArgs("00000000-0000-0000-0000-000000000001").
		WillReturnRows(sqlmock.NewRows([]string{"recipient_id"}).
			AddRow("00000000-0000-0000-0000-000000000001").
			AddRow("00000000-0000-0000-0000-000000000002"))

	broadcaster := &profileChangeBroadcaster{}
	err = broadcastProfileChange(
		context.Background(),
		db,
		broadcaster,
		`{"userId":"00000000-0000-0000-0000-000000000001","username":"new_name"}`,
	)
	if err != nil {
		t.Fatalf("broadcast profile change: %v", err)
	}
	if len(broadcaster.recipients) != 2 {
		t.Fatalf("expected two recipients, got %v", broadcaster.recipients)
	}
	var event struct {
		Type    string `json:"type"`
		Payload struct {
			UserID   string `json:"userId"`
			Username string `json:"username"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(broadcaster.payload, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "user_profile_updated" || event.Payload.Username != "new_name" {
		t.Fatalf("unexpected realtime event: %+v", event)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBroadcastProfileChangeRejectsMalformedEvent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	err = broadcastProfileChange(context.Background(), db, &profileChangeBroadcaster{}, `{}`)
	if err == nil {
		t.Fatal("expected malformed event to be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
