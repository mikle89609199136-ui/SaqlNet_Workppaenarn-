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

func TestHydrateMessagesReactions(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	messages := []Message{
		{ID: "11111111-1111-1111-1111-111111111111"},
		{ID: "22222222-2222-2222-2222-222222222222"},
	}

	mock.ExpectQuery("SELECT message_id::text").
		WithArgs(sqlmock.AnyArg(), "current-user-id").
		WillReturnRows(
			sqlmock.NewRows(
				[]string{"message_id", "emoji", "count", "my_reaction"},
			).AddRow(
				messages[0].ID,
				"❤️",
				2,
				true,
			),
		)

	service := NewService(db, nil)
	err = service.hydrateMessagesReactions(
		context.Background(),
		"current-user-id",
		messages,
	)
	if err != nil {
		t.Fatal(err)
	}

	if len(messages[0].Reactions) != 1 {
		t.Fatalf("expected one reaction, got %#v", messages[0].Reactions)
	}

	reaction := messages[0].Reactions[0]
	if reaction.Emoji != "❤️" ||
		reaction.Count != 2 ||
		!reaction.MyReaction {
		t.Fatalf("unexpected reaction: %#v", reaction)
	}

	if messages[1].Reactions == nil {
		t.Fatal("messages without reactions must contain an empty array")
	}
	if len(messages[1].Reactions) != 0 {
		t.Fatalf(
			"expected no reactions, got %#v",
			messages[1].Reactions,
		)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHydrateChatsLastMessageReactions(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	chats := []Chat{
		{
			ID: "chat-1",
			LastMessage: &LastMessagePreview{
				ID: "11111111-1111-1111-1111-111111111111",
			},
		},
		{
			ID: "chat-2",
			LastMessage: &LastMessagePreview{
				ID: "22222222-2222-2222-2222-222222222222",
			},
		},
		{
			ID:          "empty-chat",
			LastMessage: nil,
		},
	}

	mock.ExpectQuery("SELECT message_id::text").
		WithArgs(sqlmock.AnyArg(), "current-user-id").
		WillReturnRows(
			sqlmock.NewRows(
				[]string{"message_id", "emoji", "count", "my_reaction"},
			).AddRow(
				chats[0].LastMessage.ID,
				"❤️",
				2,
				true,
			),
		)

	service := NewService(db, nil)
	err = service.hydrateChatsLastMessageReactions(
		context.Background(),
		"current-user-id",
		chats,
	)
	if err != nil {
		t.Fatal(err)
	}

	if len(chats[0].LastMessage.Reactions) != 1 {
		t.Fatalf("expected one reaction, got %#v", chats[0].LastMessage.Reactions)
	}

	reaction := chats[0].LastMessage.Reactions[0]
	if reaction.Emoji != "❤️" ||
		reaction.Count != 2 ||
		!reaction.MyReaction {
		t.Fatalf("unexpected reaction: %#v", reaction)
	}

	if chats[1].LastMessage.Reactions == nil {
		t.Fatal("messages without reactions must contain an empty array")
	}
	if len(chats[1].LastMessage.Reactions) != 0 {
		t.Fatalf(
			"expected no reactions, got %#v",
			chats[1].LastMessage.Reactions,
		)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
