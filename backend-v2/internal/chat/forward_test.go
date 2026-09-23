package chat

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-playground/validator/v10"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

var attachments = []TAttachment{
	{
		MediaURL:       "mediaURL",
		ContentType:    "image/jpeg",
		FileName:       "fileName",
		FileSize:       300,
		MediaEncrypted: true,
	},
}

var content = "{\"e2e\":true,\"iv\":\"8VZfjQjsdoW7yEo9\",\"data\":\"hhBWdrsJCapQc2vCMvVibuFoPxSoZ7VxH5RBQ59HzZMqQXkLJQt1lWm3wJs=\",\"senderPublicKey\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvnpKVuUY+B/tnZ9u0nNv1UgU7vHeaAPy+GANNzfuW1m3egUUicySXvh8X8JltIiEHZEpnH4hRtHL7v6oYN7EYw==\",\"senderKeyFp\":\"k1TMi5XAgksq\",\"recipientPubKeyB64\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdmezG7acc3DWs/gggQmRgr3VpOmBOyD16C51wKoMSs+fGArmZz3HLFtm585Q6rRBTOd9F9sw/KkFWDpQ7JoC6A==\",\"recipientKeyFp\":\"0fPZysq2/uVl\"}"

var message = TMessages{
	MessageID: "00000000-0000-0000-0000-000000000003",
	SenderID:  userID,
}

var messageIDS = []string{
	"00000000-0000-0000-0000-000000000000",
	"00000000-0000-0000-0000-000000000001",
	"00000000-0000-0000-0000-000000000002",
}

const (
	chatID       = "550e8400-e29b-41d4-a716-446655440001"
	targetChatID = "00000000-0000-0000-0000-000000000003"
	userID       = "00000000-0000-0000-0000-000000000003"
)

var contents = []string{
	"{\"e2e\":true,\"iv\":\"8VZfjQjsdoW7yEo9\",\"data\":\"hhBWdrsJCapQc2vCMvVibuFoPxSoZ7VxH5RBQ59HzZMqQXkLJQt1lWm3wJs=\",\"senderPublicKey\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvnpKVuUY+B/tnZ9u0nNv1UgU7vHeaAPy+GANNzfuW1m3egUUicySXvh8X8JltIiEHZEpnH4hRtHL7v6oYN7EYw==\",\"senderKeyFp\":\"k1TMi5XAgksq\",\"recipientPubKeyB64\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdmezG7acc3DWs/gggQmRgr3VpOmBOyD16C51wKoMSs+fGArmZz3HLFtm585Q6rRBTOd9F9sw/KkFWDpQ7JoC6A==\",\"recipientKeyFp\":\"0fPZysq2/uVl\"}",
	"{\"e2e\":true,\"iv\":\"8VZfjQjsdoW7yEo9\",\"data\":\"hhBWdrsJCapQc2vCMvVibuFoPxSoZ7VxH5RBQ59HzZMqQXkLJQt1lWm3wJs=\",\"senderPublicKey\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvnpKVuUY+B/tnZ9u0nNv1UgU7vHeaAPy+GANNzfuW1m3egUUicySXvh8X8JltIiEHZEpnH4hRtHL7v6oYN7EYw==\",\"senderKeyFp\":\"k1TMi5XAgksq\",\"recipientPubKeyB64\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdmezG7acc3DWs/gggQmRgr3VpOmBOyD16C51wKoMSs+fGArmZz3HLFtm585Q6rRBTOd9F9sw/KkFWDpQ7JoC6A==\",\"recipientKeyFp\":\"0fPZysq2/uVl\"}",
	"{\"e2e\":true,\"iv\":\"8VZfjQjsdoW7yEo9\",\"data\":\"hhBWdrsJCapQc2vCMvVibuFoPxSoZ7VxH5RBQ59HzZMqQXkLJQt1lWm3wJs=\",\"senderPublicKey\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvnpKVuUY+B/tnZ9u0nNv1UgU7vHeaAPy+GANNzfuW1m3egUUicySXvh8X8JltIiEHZEpnH4hRtHL7v6oYN7EYw==\",\"senderKeyFp\":\"k1TMi5XAgksq\",\"recipientPubKeyB64\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdmezG7acc3DWs/gggQmRgr3VpOmBOyD16C51wKoMSs+fGArmZz3HLFtm585Q6rRBTOd9F9sw/KkFWDpQ7JoC6A==\",\"recipientKeyFp\":\"0fPZysq2/uVl\"}",
}

var metadata = []string{
	`{}`,
	`{"forwarded":true,"forwardedFrom":{"messageId":"00000000-0000-0000-0000-000000000003","senderId":"00000000-0000-0000-0000-000000000003","senderName":"Alice"}}`,
	`{"forwarded":true,"forwardedFrom":{"messageId":"00000000-0000-0000-0000-000000000001","senderId":"00000000-0000-0000-0000-000000000003","senderName":"Alice"}}`,
}

var messageType = []string{
	"text",
	"text",
	"text",
}

type mockRealtimeServer struct {
	called        bool
	chatID        string
	message       []byte
	excludeUserID string
}

func (m *mockRealtimeServer) CallRooms() *CallRoomManager {
	return nil
}

func (m *mockRealtimeServer) IsUserConnected(userID string) bool {
	return false
}

func (m *mockRealtimeServer) BroadcastToChat(
	chatID string,
	message []byte,
	excludeUserID string,
) {
	m.called = true
	m.chatID = chatID
	m.message = message
	m.excludeUserID = excludeUserID
}

func (m *mockRealtimeServer) BroadcastToUsers(
	userIDs []string,
	message []byte,
) {
}

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

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO messages\\.messages").
		WithArgs("target-chat", "user-id", "", "file", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "type", "reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at"}).
			AddRow("forward-id", "target-chat", "user-id", "User", "", "", "file", nil, []byte(`{"mediaUrl":"/api/v2/media/upload-id","mediaType":"application/pdf","fileName":"document.pdf","sizeBytes":245760,"forwardedFrom":"message-id","forwardedSenderName":"Anna"}`), false, false, "created", "updated", nil))
	mock.ExpectCommit()

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

func TestForwardMessageInput_Validation(t *testing.T) {
	validate := validator.New()

	type validationError struct {
		field string
		tag   string
	}

	messageDATA := message

	messageDATA.Content = content
	messageDATA.Attachments = attachments

	tests := []struct {
		name       string
		input      ForwardMessageInput
		wantErrors []validationError
		wantError  bool
	}{
		{
			name: "valid",
			input: ForwardMessageInput{
				ChatID:       "550e8400-e29b-41d4-a716-446655440001",
				TargetChatID: "550e8400-e29b-41d4-a716-446655440002",
				Messages: []TMessages{
					messageDATA,
				},
			},
			wantErrors: []validationError{},
			wantError:  false,
		},
		{
			name: "invalid_input",
			input: ForwardMessageInput{
				ChatID:       "e",
				TargetChatID: "null",
				Messages:     []TMessages{},
			},
			wantErrors: []validationError{
				{field: "ChatID", tag: "uuid"},
				{field: "TargetChatID", tag: "uuid"},
				{field: "Messages", tag: "gt"},
			},
			wantError: true,
		},
		{
			name: "invalid_message_fields",
			input: ForwardMessageInput{
				ChatID:       "550e8400-e29b-41d4-a716-446655440001",
				TargetChatID: "550e8400-e29b-41d4-a716-446655440002",
				Messages: []TMessages{
					{
						MessageID: "",
						SenderID:  "",
						Content:   "",
					},
				},
			},
			wantError: true,
			wantErrors: []validationError{
				{field: "MessageID", tag: "required"},
				{field: "SenderID", tag: "required"},
				{field: "Forwarded", tag: "eq"},
				{field: "MessageID", tag: "uuid"},
				{field: "SenderID", tag: "required"},
			},
		},
		{
			name: "invalid_attachments",
			input: ForwardMessageInput{
				ChatID:       "550e8400-e29b-41d4-a716-446655440001",
				TargetChatID: "550e8400-e29b-41d4-a716-446655440002",
				Messages: []TMessages{
					{
						MessageID: "550e8400-e29b-41d4-a716-446655440003",
						SenderID:  "550e8400-e29b-41d4-a716-446655440004",
						Content:   content,
						Attachments: []TAttachment{
							{
								MediaURL:       "",
								ContentType:    "",
								FileName:       "",
								FileSize:       0,
								MediaEncrypted: false,
							},
						},
					},
				},
			},
			wantError: true,
			wantErrors: []validationError{
				{field: "MediaURL", tag: "required"},
				{field: "ContentType", tag: "required"},
				{field: "FileName", tag: "required"},
				{field: "FileSize", tag: "required"},
				{field: "MediaEncrypted", tag: "eq"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validate.Struct(tt.input)

			if !tt.wantError {
				require.NoError(t, err)
				return
			}

			require.Error(t, err)

			validationErrors, ok := err.(validator.ValidationErrors)
			require.True(t, ok)

			require.Len(t, validationErrors, len(tt.wantErrors))

			for i, want := range tt.wantErrors {
				require.Equal(t, want.field, validationErrors[i].Field())
				require.Equal(t, want.tag, validationErrors[i].Tag())
			}

		})

	}

}

func selectMessages(mock sqlmock.Sqlmock) {
	rows := sqlmock.NewRows([]string{
		"id",
		"type",
		"sender_id",
		"sender_name",
	}).
		AddRow(
			message.MessageID,
			"text",
			message.SenderID,
			"Alice",
		).
		AddRow(
			messageIDS[1],
			"text",
			message.SenderID,
			"Alice",
		)

	mock.ExpectQuery(`SELECT m.id, m.type, m.sender_id, COALESCE\(up.first_name, au.first_name, au.username, ''\)`).
		WithArgs(chatID, sqlmock.AnyArg()).
		WillReturnRows(rows)
}

func InsertSqlMok(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO messages.messages").WithArgs(sqlmock.AnyArg(), targetChatID, userID, pq.Array(contents), pq.Array(metadata), pq.Array(messageType)).WillReturnResult(sqlmock.NewResult(1, 1))
}

func InsertSqlMokAttachments(mock sqlmock.Sqlmock) {
	attachmentPosition := []int{
		0,
	}

	mediaURL := []string{
		"mediaURL",
	}

	mediaTypes := []string{
		"image/jpeg",
	}

	fileName := []string{
		"fileName",
	}

	fileSize := []int64{
		300,
	}

	mediaEncrypted := []bool{
		true,
	}
	mock.ExpectExec("INSERT INTO messages.attachments").WithArgs(sqlmock.AnyArg(), pq.Array(attachmentPosition),
		pq.Array(mediaURL), pq.Array(mediaTypes), pq.Array(fileName), pq.Array(fileSize), pq.Array(mediaEncrypted)).WillReturnResult(sqlmock.NewResult(1, 1))
}

func SelectFromMessages(mock sqlmock.Sqlmock, err bool) {
	attachmentsJSON := []byte(`[
		{
			"id": "00000000-0000-0000-0000-000000000010",
			"messageId": "00000000-0000-0000-0000-000000000001",
			"position": 0,
			"mediaUrl": "mediaURL",
			"mediaType": "image/jpeg",
			"fileName": "fileName",
			"sizeBytes": 300,
			"mediaEncrypted": true,
			"createdAt": "2026-08-28T12:00:00Z"
		}
	
]`)

	rows := sqlmock.NewRows([]string{
		"id",
		"chat_id",
		"sender_id",
		"content",
		"metadata",
		"type",
		"created_at",
		"attachments",
	})

	// SELECT вернул caption
	rows.AddRow(
		messageIDS[0],
		targetChatID,
		userID,
		contents[0],
		metadata[0],
		messageType[0],
		time.Now(),
		[]byte(`[]`),
	)

	// SELECT вернул первое forwarded-сообщение с attachment
	rows.AddRow(
		messageIDS[1],
		targetChatID,
		userID,
		contents[1],
		metadata[1],
		messageType[1],
		time.Now(),
		attachmentsJSON,
	)

	// SELECT вернул второе forwarded-сообщение без attachment
	rows.AddRow(
		messageIDS[2],
		targetChatID,
		userID,
		contents[2],
		metadata[2],
		messageType[2],
		time.Now(),
		[]byte(`[]`),
	)

	query := mock.ExpectQuery(`SELECT.*FROM messages\.messages m`).
		WithArgs(sqlmock.AnyArg())

	if err {
		query.WillReturnError(errors.New("select messages error"))
	} else {
		query.WillReturnRows(rows)
	}

}

func selectSingleMessage(mock sqlmock.Sqlmock) {
	rows := sqlmock.NewRows([]string{
		"id",
		"type",
		"sender_id",
		"sender_name",
	}).AddRow(
		message.MessageID,
		"text",
		message.SenderID,
		"Alice",
	)

	mock.ExpectQuery(`SELECT m.id, m.type, m.sender_id, COALESCE\(up.first_name, au.first_name, au.username, ''\)`).
		WithArgs(chatID, sqlmock.AnyArg()).
		WillReturnRows(rows)
}

func TestSendForwardMessages(t *testing.T) {
	messageDATA := message
	messageDATA.Content = content
	messageDATA.Attachments = attachments

	messageDATA2 := messageDATA
	messageDATA2.MessageID = messageIDS[1]
	messageDATA2.Attachments = nil

	messages := []TMessages{
		messageDATA,
		messageDATA2,
	}

	var caption = content

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectBegin()

	selectMessages(mock)
	InsertSqlMok(mock)
	InsertSqlMokAttachments(mock)
	SelectFromMessages(mock, false)

	mock.ExpectCommit()

	ws := &mockRealtimeServer{}
	service := NewService(db, ws)

	result, err := service.sendForwardMessages(
		context.Background(),
		messages,
		caption,
		targetChatID,
		chatID,
		userID,
	)

	require.NoError(t, err)

	// Проверяем WebSocket event.
	require.True(t, ws.called)
	require.Equal(t, targetChatID, ws.chatID)
	require.Equal(t, userID, ws.excludeUserID)

	var event struct {
		Type     string              `json:"type"`
		ChatID   string              `json:"chatId"`
		Messages []ResForwardMessage `json:"messages"`
	}

	require.NoError(t, json.Unmarshal(ws.message, &event))
	require.Equal(t, "new_messages", event.Type)
	require.Equal(t, targetChatID, event.ChatID)
	require.Len(t, event.Messages, 3)

	require.Len(t, result, 3)

	// Caption добавлен первым.
	require.Equal(t, caption, result[0].Content)

	// Первое forwarded-сообщение с attachments.
	require.Len(t, result[1].Attachments, 1)

	// Второе forwarded-сообщение без attachments.
	require.Empty(t, result[2].Attachments)

	// Проверяем порядок по Content.
	require.Equal(t, contents[0], result[1].Content)
	require.Equal(t, contents[0], result[2].Content)

	actualBytes1, err := json.Marshal(result[1].Metadata)
	require.NoError(t, err)

	actualBytes2, err := json.Marshal(result[2].Metadata)
	require.NoError(t, err)

	require.JSONEq(t, string(metadata[1]), string(actualBytes1))
	require.JSONEq(t, string(metadata[2]), string(actualBytes2))

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendForwardMessages_Transaction_InsertMessagesError(t *testing.T) {
	messageDATA := message
	messageDATA.Attachments = attachments
	messageDATA.Content = content
	messageDATA2 := messageDATA
	messageDATA2.MessageID = messageIDS[1]
	messageDATA2.Attachments = nil
	messageDATA2.Content = content

	messages := []TMessages{
		messageDATA,
		messageDATA2,
	}

	var caption = content

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectBegin()
	selectMessages(mock)
	InsertSqlMok(mock)
	InsertSqlMokAttachments(mock)
	SelectFromMessages(mock, true)

	mock.ExpectRollback()

	result, err := NewService(db, nil).sendForwardMessages(context.Background(), messages, caption, targetChatID, chatID, userID)

	require.Error(t, err)
	require.Nil(t, result)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendForwardMessages_PlaintextContent(t *testing.T) {
	messageDATA := message
	messageDATA.Content = "hello"
	messageDATA.Attachments = nil

	messages := []TMessages{
		messageDATA,
	}

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectBegin()
	selectSingleMessage(mock)
	mock.ExpectRollback()

	ws := &mockRealtimeServer{}
	service := NewService(db, ws)

	result, err := service.sendForwardMessages(
		context.Background(),
		messages,
		"",
		targetChatID,
		chatID,
		userID,
	)

	require.ErrorIs(t, err, ErrForbidden)
	require.Nil(t, result)
	require.False(t, ws.called)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendForwardMessages_PlaintextCaption(t *testing.T) {
	messageDATA := message
	messageDATA.Content = content
	messageDATA.Attachments = nil

	messages := []TMessages{
		messageDATA,
	}

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectBegin()
	selectSingleMessage(mock)
	mock.ExpectRollback()

	ws := &mockRealtimeServer{}
	service := NewService(db, ws)

	result, err := service.sendForwardMessages(
		context.Background(),
		messages,
		"hello",
		targetChatID,
		chatID,
		userID,
	)

	require.ErrorIs(t, err, ErrForbidden)
	require.Nil(t, result)
	require.False(t, ws.called)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendForwardMessages_MessageNotFound(t *testing.T) {
	messageDATA := message
	messageDATA.Content = content
	messageDATA.Attachments = nil

	messageDATA2 := messageDATA
	messageDATA2.MessageID = messageIDS[1]

	messages := []TMessages{
		messageDATA,
		messageDATA2,
	}

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectBegin()

	// Клиент запросил 2 сообщения,
	// но в исходном чате найдено только 1.
	rows := sqlmock.NewRows([]string{
		"id",
		"type",
		"sender_id",
		"sender_name",
	}).AddRow(
		message.MessageID,
		"text",
		message.SenderID,
		"Alice",
	)

	mock.ExpectQuery(`SELECT m.id, m.type, m.sender_id, COALESCE\(up.first_name, au.first_name, au.username, ''\)`).
		WithArgs(chatID, sqlmock.AnyArg()).
		WillReturnRows(rows)

	mock.ExpectRollback()

	ws := &mockRealtimeServer{}
	service := NewService(db, ws)

	result, err := service.sendForwardMessages(
		context.Background(),
		messages,
		"",
		targetChatID,
		chatID,
		userID,
	)

	require.ErrorIs(t, err, ErrNotFound)
	require.Nil(t, result)

	// Никакого WebSocket-события при ошибке.
	require.False(t, ws.called)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestForwardMessages_NotMemberOfChats(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chats\.members m`).
		WithArgs(
			userID,
			sqlmock.AnyArg(),
			2,
		).
		WillReturnRows(
			sqlmock.NewRows([]string{"exists"}).AddRow(false),
		)

	service := NewService(db, nil)

	result, err := service.ForwardMessages(
		context.Background(),
		userID,
		chatID,
		targetChatID,
		"",
		[]TMessages{},
	)

	require.ErrorIs(t, err, ErrForbidden)
	require.Nil(t, result)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestForwardMessages_IsMemberOfChatsError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	expectedErr := errors.New("database error")

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chats\.members m`).
		WithArgs(
			userID,
			sqlmock.AnyArg(),
			2,
		).
		WillReturnError(expectedErr)

	service := NewService(db, nil)

	result, err := service.ForwardMessages(
		context.Background(),
		userID,
		chatID,
		targetChatID,
		"",
		[]TMessages{},
	)

	require.ErrorIs(t, err, expectedErr)
	require.Nil(t, result)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendForwardMessages_DoesNotTrustClientSenderID(t *testing.T) {
	messageDATA := message
	messageDATA.Content = content
	messageDATA.SenderID = "99999999-9999-9999-9999-999999999999"
	messageDATA.Attachments = nil

	messages := []TMessages{messageDATA}

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectBegin()

	selectSingleMessage(mock)

	mock.ExpectExec("INSERT INTO messages.messages").
		WithArgs(
			sqlmock.AnyArg(),
			targetChatID,
			userID,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	rows := sqlmock.NewRows([]string{
		"id",
		"chat_id",
		"sender_id",
		"content",
		"metadata",
		"type",
		"created_at",
		"attachments",
	}).AddRow(
		messageIDS[0],
		targetChatID,
		userID,
		content,
		metadata[1],
		"text",
		time.Now(),
		[]byte(`[]`),
	)

	mock.ExpectQuery(`SELECT.*FROM messages\.messages m`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(rows)

	mock.ExpectCommit()

	ws := &mockRealtimeServer{}
	service := NewService(db, ws)

	result, err := service.sendForwardMessages(
		context.Background(),
		messages,
		"",
		targetChatID,
		chatID,
		userID,
	)

	require.NoError(t, err)
	require.Len(t, result, 1)

	forwardedFrom, ok := result[0].Metadata["forwardedFrom"].(map[string]any)
	require.True(t, ok)

	require.Equal(t, userID, forwardedFrom["senderId"])
	require.Equal(t, "Alice", forwardedFrom["senderName"])

	require.NoError(t, mock.ExpectationsWereMet())
}
