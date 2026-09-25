package chat

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	forwardSourceChatID   = "550e8400-e29b-41d4-a716-446655440010"
	forwardOriginalID     = "550e8400-e29b-41d4-a716-446655440011"
	forwardSourceQuery    = `SELECT m\.chat_id::text, COALESCE`
	forwardMembershipStmt = `SELECT EXISTS`
)

var forwardSourceColumns = []string{"chat_id", "sender_name", "metadata"}

// forwardMetadataArg matches the metadata JSON written by the INSERT.
type forwardMetadataArg struct {
	from string
	name string
}

func (a forwardMetadataArg) Match(value driver.Value) bool {
	raw, ok := value.([]byte)
	if !ok {
		return false
	}
	var metadata map[string]any
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return false
	}
	return metadata["forwardedFrom"] == a.from && metadata["forwardedSenderName"] == a.name
}

func TestForwardOriginReturnsForwardedMessageAuthor(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
		WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", []byte(`{}`)))
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	originID, name, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

	require.NoError(t, err)
	require.Equal(t, messageValidationMessageID, originID)
	require.Equal(t, "Anna", name)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestForwardOriginKeepsOriginalAuthorOfForwardedMessage(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	metadata := `{"forwardedFrom":"` + forwardOriginalID + `","forwardedSenderName":"Boris"}`
	mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
		WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", []byte(metadata)))
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	originID, name, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

	require.NoError(t, err)
	require.Equal(t, forwardOriginalID, originID)
	require.Equal(t, "Boris", name)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestForwardOriginRejectsUnavailableMessage(t *testing.T) {
	tests := []struct {
		name      string
		messageID string
		setup     func(mock sqlmock.Sqlmock)
		wantErr   error
	}{
		{
			name:      "malformed id",
			messageID: "not-a-uuid",
			setup:     func(sqlmock.Sqlmock) {},
			wantErr:   ErrInvalidInput,
		},
		{
			name:      "missing or deleted message",
			messageID: messageValidationMessageID,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
					WillReturnError(sql.ErrNoRows)
			},
			wantErr: ErrNotFound,
		},
		{
			name:      "message from a chat the requester is not in",
			messageID: messageValidationMessageID,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
					WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", []byte(`{}`)))
				mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
			},
			wantErr: ErrNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			tt.setup(mock)

			originID, name, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, tt.messageID)

			require.ErrorIs(t, err, tt.wantErr)
			require.Empty(t, originID)
			require.Empty(t, name)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestSendMessageStoresForwardedFrom(t *testing.T) {
	handler, mock := messageValidationHandler(t)
	mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
		WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", []byte(`{}`)))
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT cm\.role`).
		WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery(`WITH inserted AS`).
		WithArgs(
			messageValidationChatID,
			messageValidationUserID,
			"forwarded text",
			"text",
			sql.NullString{},
			forwardMetadataArg{from: messageValidationMessageID, name: "Anna"},
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
			"content", "type", "reply_to", "metadata", "is_pinned", "is_edited",
			"created_at", "updated_at", "deleted_at",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440020",
			messageValidationChatID,
			messageValidationUserID,
			"Alice",
			"",
			"forwarded text",
			"text",
			nil,
			[]byte(`{"forwardedFrom":"`+messageValidationMessageID+`","forwardedSenderName":"Anna"}`),
			false,
			false,
			"2026-09-24T00:00:00Z",
			"2026-09-24T00:00:00Z",
			nil,
		))
	mock.ExpectCommit()

	recorder := httptest.NewRecorder()
	req := messageValidationRequest(
		http.MethodPost,
		"/api/v2/messages/"+messageValidationChatID,
		`{"type":"text","content":"forwarded text","forwardedFrom":"`+messageValidationMessageID+`","forwardedSenderName":"Mallory"}`,
		"chatId",
		messageValidationChatID,
	)

	handler.SendMessage(recorder, req)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var body struct {
		Message struct {
			IsForwarded         bool   `json:"isForwarded"`
			ForwardedSenderName string `json:"forwardedSenderName"`
		} `json:"message"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.True(t, body.Message.IsForwarded)
	require.Equal(t, "Anna", body.Message.ForwardedSenderName)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessageRejectsUnavailableForwardedFromWithoutInsert(t *testing.T) {
	tests := []struct {
		name          string
		forwardedFrom string
		setup         func(mock sqlmock.Sqlmock)
	}{
		{
			name:          "malformed id",
			forwardedFrom: "not-a-uuid",
			setup:         func(sqlmock.Sqlmock) {},
		},
		{
			name:          "missing or deleted message",
			forwardedFrom: messageValidationMessageID,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
					WillReturnError(sql.ErrNoRows)
			},
		},
		{
			name:          "message from a chat the requester is not in",
			forwardedFrom: messageValidationMessageID,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
					WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", []byte(`{}`)))
				mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, mock := messageValidationHandler(t)
			tt.setup(mock)

			recorder := httptest.NewRecorder()
			req := messageValidationRequest(
				http.MethodPost,
				"/api/v2/messages/"+messageValidationChatID,
				`{"type":"text","content":"forwarded text","forwardedFrom":"`+tt.forwardedFrom+`"}`,
				"chatId",
				messageValidationChatID,
			)

			handler.SendMessage(recorder, req)

			assertErrorResponse(t, recorder, http.StatusBadRequest, "validation_failed")
			require.NotContains(t, recorder.Body.String(), "Anna")
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestForwardMessageKeepsOriginalAuthorOfForwardedMessage(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	metadata := `{"forwardedFrom":"` + forwardOriginalID + `","forwardedSenderName":"Boris"}`
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, messageValidationChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT m.id::text, m.chat_id::text, m.sender_id::text").WithArgs(messageValidationMessageID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "content", "type", "reply_to", "metadata", "created_at", "updated_at", "deleted_at"}).
			AddRow(messageValidationMessageID, forwardSourceChatID, "sender-id", "Anna", "text", "text", nil, []byte(metadata), "created", "updated", nil))
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT cm\.role`).WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery(`WITH inserted AS`).
		WithArgs(messageValidationChatID, messageValidationUserID, "text", "text", sqlmock.AnyArg(), forwardMetadataArg{from: forwardOriginalID, name: "Boris"}).
		WillReturnRows(sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "type", "reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at"}).
			AddRow("forward-id", messageValidationChatID, messageValidationUserID, "User", "", "text", "text", nil, []byte(metadata), false, false, "created", "updated", nil))
	mock.ExpectCommit()

	msg, err := NewService(db, nil, nil).ForwardMessage(context.Background(), messageValidationUserID, messageValidationMessageID, messageValidationChatID)

	require.NoError(t, err)
	require.True(t, msg.IsForwarded)
	require.Equal(t, "Boris", msg.ForwardedSenderName)
	require.NoError(t, mock.ExpectationsWereMet())
}
