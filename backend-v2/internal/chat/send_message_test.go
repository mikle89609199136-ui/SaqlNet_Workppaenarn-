package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func sentMessageRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
		"content", "type", "reply_to", "content_encrypted",
		"forwarded_message_id", "forwarded_sender_id", "forwarded_sender_name",
		"is_pinned", "is_edited", "created_at", "updated_at", "deleted_at",
	}).AddRow(
		"message-id", "chat-id", "user-id", "User", "",
		"caption", "file", nil, false,
		nil, nil, nil, false, false, "created", "updated", nil,
	)
}

func TestSendMessageCommitsMessageAndAttachmentsTogether(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT cm.role").WithArgs("chat-id", "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO messages.messages").
		WillReturnRows(sentMessageRows())
	mock.ExpectQuery("INSERT INTO messages.attachments").
		WithArgs("message-id", 0, "/api/v2/media/upload-id", "file", "document.pdf", int64(100), false, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("attachment-id"))
	mock.ExpectCommit()

	msg, err := NewService(db, nil).SendMessage(context.Background(), "user-id", "chat-id", SendMessageParams{
		Content: "caption",
		Type:    "file",
		Attachments: []AttachmentData{{
			Position: 0, MediaURL: "/api/v2/media/upload-id", MediaType: "file",
			FileName: "document.pdf", SizeBytes: 100,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(msg.Attachments) != 1 || msg.Attachments[0].ID != "attachment-id" {
		t.Fatalf("unexpected attachments: %#v", msg.Attachments)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSendMessageRollsBackWhenAttachmentInsertFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT cm.role").WithArgs("chat-id", "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO messages.messages").WillReturnRows(sentMessageRows())
	mock.ExpectQuery("INSERT INTO messages.attachments").WillReturnError(errors.New("insert failed"))
	mock.ExpectRollback()

	_, err = NewService(db, nil).SendMessage(context.Background(), "user-id", "chat-id", SendMessageParams{
		Content: "caption",
		Type:    "file",
		Attachments: []AttachmentData{{
			Position: 0, MediaURL: "/api/v2/media/upload-id", MediaType: "file",
			FileName: "document.pdf", SizeBytes: 100,
		}},
	})
	if err == nil {
		t.Fatal("expected attachment insert error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHydrateMessagesAttachmentsLoadsAllMessagesInOneQuery(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery("FROM messages.attachments").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "message_id", "position", "media_url", "media_type",
			"file_name", "size_bytes", "media_encrypted", "media_encryption",
		}).
			AddRow("attachment-a", "message-a", 0, "/media/a", "image", "a.jpg", 10, false, nil).
			AddRow("attachment-b", "message-b", 0, "/media/b", "file", "b.pdf", 20, false, nil))

	messages := []Message{{ID: "message-a"}, {ID: "message-b"}, {ID: "message-c"}}
	if err := NewService(db, nil).hydrateMessagesAttachments(context.Background(), messages); err != nil {
		t.Fatal(err)
	}
	if len(messages[0].Attachments) != 1 || messages[0].Attachments[0].FileName != "a.jpg" {
		t.Fatalf("message-a attachments: %#v", messages[0].Attachments)
	}
	if len(messages[1].Attachments) != 1 || messages[1].Attachments[0].FileName != "b.pdf" {
		t.Fatalf("message-b attachments: %#v", messages[1].Attachments)
	}
	if messages[2].Attachments == nil || len(messages[2].Attachments) != 0 {
		t.Fatalf("message-c must have an empty attachment array: %#v", messages[2].Attachments)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
