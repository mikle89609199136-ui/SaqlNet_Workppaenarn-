package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestForwardMessagePreservesMediaMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	metadata := `{"mediaUrl":"/api/v2/media/upload-id","mediaType":"application/pdf","fileName":"document.pdf","sizeBytes":245760}`
	mock.ExpectQuery("SELECT EXISTS").WithArgs("user-id", "target-chat").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT m.id::text, m.chat_id::text, m.sender_id::text").WithArgs("message-id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "content", "type", "reply_to", "metadata", "created_at", "updated_at", "deleted_at"}).
			AddRow("message-id", "source-chat", "sender-id", "Anna", "", "file", nil, []byte(metadata), "created", "updated", nil))
	mock.ExpectQuery("SELECT EXISTS").WithArgs("user-id", "source-chat").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT cm.role").WithArgs("target-chat", "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted"}).AddRow("member", false))
	mock.ExpectQuery("INSERT INTO messages\\.messages").
		WithArgs("target-chat", "user-id", "", "file", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "type", "reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at"}).
			AddRow("forward-id", "target-chat", "user-id", "User", "", "", "file", nil, []byte(`{"mediaUrl":"/api/v2/media/upload-id","mediaType":"application/pdf","fileName":"document.pdf","sizeBytes":245760,"forwardedFrom":"message-id","forwardedSenderName":"Anna"}`), false, false, "created", "updated", nil))

	msg, err := NewService(db, nil).ForwardMessage(context.Background(), "user-id", "message-id", "target-chat")
	if err != nil {
		t.Fatal(err)
	}
	if msg.Metadata["fileName"] != "document.pdf" || msg.Metadata["sizeBytes"] != float64(245760) || msg.Metadata["forwardedFrom"] != "message-id" {
		encoded, _ := json.Marshal(msg.Metadata)
		t.Fatalf("metadata was not preserved: %s", encoded)
	}
	if !msg.IsForwarded || msg.ForwardedSenderName != "Anna" || msg.SenderFirstName != "User" {
		t.Fatalf("derived fields were not populated: %#v", msg)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
