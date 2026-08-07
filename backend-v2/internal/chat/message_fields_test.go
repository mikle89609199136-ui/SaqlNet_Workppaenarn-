package chat

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestHydrateMessageFieldsPopulatesReplyAliases(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	replyID := "reply-id"
	mock.ExpectQuery("SELECT COALESCE").WithArgs(replyID).
		WillReturnRows(sqlmock.NewRows([]string{"name"}).AddRow("Анна"))

	msg := Message{SenderName: "Иван", ReplyTo: &replyID}
	if err := NewService(db, nil).hydrateMessageFields(context.Background(), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.SenderFirstName != "Иван" || msg.ReplyToMessageID == nil || *msg.ReplyToMessageID != replyID {
		t.Fatalf("message aliases were not populated: %#v", msg)
	}
	if msg.ReplySenderName != "Анна" || msg.ReplyToSenderName != "Анна" {
		t.Fatalf("reply sender was not populated: %#v", msg)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
