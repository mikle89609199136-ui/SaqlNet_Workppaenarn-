package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func expectMembership(mock sqlmock.Sqlmock, userID, chatID string) {
	mock.ExpectQuery("SELECT EXISTS").WithArgs(userID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
}

func sourceMessageRows(contentEncrypted bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
		"content", "type", "reply_to", "content_encrypted",
		"forwarded_message_id", "forwarded_sender_id", "forwarded_sender_name",
		"is_pinned", "is_edited", "created_at", "updated_at", "deleted_at",
	}).AddRow(
		"message-id", "source-chat", "sender-id", "Anna", "",
		"caption", "file", nil, contentEncrypted,
		nil, nil, nil, false, false, "created", "updated", nil,
	)
}

func TestForwardMessageCopiesUnencryptedAttachments(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, "user-id", "target-chat")
	mock.ExpectQuery("SELECT m.id::text, m.chat_id::text, m.sender_id::text").WithArgs("message-id").
		WillReturnRows(sourceMessageRows(false))
	expectMembership(mock, "user-id", "source-chat")
	mock.ExpectQuery("FROM messages.attachments").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "message_id", "position", "media_url", "media_type",
			"file_name", "size_bytes", "media_encrypted", "media_encryption",
		}).AddRow("attachment-id", "message-id", 0, "/api/v2/media/upload-id", "file", "document.pdf", 245760, false, nil))
	mock.ExpectQuery("SELECT cm.role").WithArgs("target-chat", "user-id").
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO messages.messages").
		WithArgs("target-chat", "user-id", "caption", "file", sqlmock.AnyArg(), false, "message-id", "sender-id", "Anna").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
			"content", "type", "reply_to", "content_encrypted",
			"forwarded_message_id", "forwarded_sender_id", "forwarded_sender_name",
			"is_pinned", "is_edited", "created_at", "updated_at", "deleted_at",
		}).AddRow(
			"forward-id", "target-chat", "user-id", "User", "",
			"caption", "file", nil, false,
			"message-id", "sender-id", "Anna", false, false, "created", "updated", nil,
		))
	mock.ExpectQuery("INSERT INTO messages.attachments").
		WithArgs("forward-id", 0, "/api/v2/media/upload-id", "file", "document.pdf", int64(245760), false, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("new-attachment-id"))
	mock.ExpectCommit()

	msg, err := NewService(db, nil).ForwardMessage(context.Background(), "user-id", "message-id", ForwardMessageParams{TargetChatID: "target-chat"})
	if err != nil {
		t.Fatal(err)
	}
	if msg.Forwarded == nil || msg.Forwarded.MessageID != "message-id" || msg.Forwarded.SenderName != "Anna" {
		t.Fatalf("forward snapshot was not populated: %#v", msg.Forwarded)
	}
	if len(msg.Attachments) != 1 || msg.Attachments[0].ID != "new-attachment-id" || msg.Attachments[0].FileName != "document.pdf" {
		t.Fatalf("attachment was not copied: %#v", msg.Attachments)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestForwardMessageRequiresClientReencryptionForEncryptedAttachment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, "user-id", "target-chat")
	mock.ExpectQuery("SELECT m.id::text, m.chat_id::text, m.sender_id::text").WithArgs("message-id").
		WillReturnRows(sourceMessageRows(false))
	expectMembership(mock, "user-id", "source-chat")
	mock.ExpectQuery("FROM messages.attachments").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "message_id", "position", "media_url", "media_type",
			"file_name", "size_bytes", "media_encrypted", "media_encryption",
		}).AddRow("attachment-id", "message-id", 0, "/api/v2/media/upload-id", "file", "document.pdf", 245760, true, []byte(`{"algorithm":"AES-GCM","encrypted":true,"iv":"iv","version":1}`)))

	_, err = NewService(db, nil).ForwardMessage(context.Background(), "user-id", "message-id", ForwardMessageParams{TargetChatID: "target-chat"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
