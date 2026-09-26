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
	forwardSourceChatID     = "550e8400-e29b-41d4-a716-446655440010"
	forwardOriginalID       = "550e8400-e29b-41d4-a716-446655440011"
	forwardAuthorID         = "550e8400-e29b-41d4-a716-446655440012"
	forwardOriginalAuthorID = "550e8400-e29b-41d4-a716-446655440013"
	forwardSourceQuery      = `SELECT m\.chat_id::text, COALESCE`
	forwardMembershipStmt   = `SELECT EXISTS`
	forwardsRuleQuery       = `FROM auth\.users\s+LEFT JOIN users\.settings AS settings`
	forwardOriginAuthorStmt = `SELECT sender_id::text FROM messages\.messages WHERE id = \$1`
)

var forwardSourceColumns = []string{"chat_id", "sender_name", "sender_id", "metadata"}

// forwardMetadataArg matches the metadata JSON written by the INSERT.
// Empty from means the link to the original is hidden (#785).
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
	if metadata["forwardedSenderName"] != a.name {
		return false
	}
	if a.from == "" {
		_, linked := metadata["forwardedFrom"]
		return !linked && metadata["forwardedHidden"] == true
	}
	_, hidden := metadata["forwardedHidden"]
	return !hidden && metadata["forwardedFrom"] == a.from
}

// expectForwardSource — сообщение от автора forwardAuthorID в чате, где
// пересылающий состоит.
func expectForwardSource(mock sqlmock.Sqlmock, metadata string) {
	mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
		WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", forwardAuthorID, []byte(metadata)))
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
}

// expectForwardsRule — правило «Пересылка» автора для пересылающего.
func expectForwardsRule(mock sqlmock.Sqlmock, author, settings string, blocked bool, exceptions string) {
	var rawSettings, rawExceptions any
	if settings != "" {
		rawSettings = []byte(settings)
	}
	if exceptions != "" {
		rawExceptions = []byte(exceptions)
	}
	mock.ExpectQuery(forwardsRuleQuery).WithArgs(author, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"privacy_settings", "blocked", "exceptions"}).
			AddRow(rawSettings, blocked, rawExceptions))
}

func TestForwardOriginReturnsForwardedMessageAuthor(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	expectForwardSource(mock, `{}`)
	expectForwardsRule(mock, forwardAuthorID, "", false, "")

	source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

	require.NoError(t, err)
	require.Equal(t, ForwardSource{MessageID: messageValidationMessageID, SenderName: "Anna"}, source)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestForwardOriginKeepsOriginalAuthorOfForwardedMessage(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	expectForwardSource(mock, `{"forwardedFrom":"`+forwardOriginalID+`","forwardedSenderName":"Boris"}`)
	// Правило — первоисточника, а не того, кто переслал его первым.
	mock.ExpectQuery(forwardOriginAuthorStmt).WithArgs(forwardOriginalID).
		WillReturnRows(sqlmock.NewRows([]string{"sender_id"}).AddRow(forwardOriginalAuthorID))
	expectForwardsRule(mock, forwardOriginalAuthorID, "", false, "")

	source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

	require.NoError(t, err)
	require.Equal(t, ForwardSource{MessageID: forwardOriginalID, SenderName: "Boris"}, source)
	require.NoError(t, mock.ExpectationsWereMet())
}

// Правило «Пересылка» (#785): при запрете остаётся только имя.
func TestForwardOriginFollowsForwardsRule(t *testing.T) {
	linked := ForwardSource{MessageID: messageValidationMessageID, SenderName: "Anna"}
	nameOnly := ForwardSource{SenderName: "Anna"}

	for name, tt := range map[string]struct {
		settings, exceptions string
		blocked              bool
		want                 ForwardSource
	}{
		"настроек нет — ссылка есть": {want: linked},
		"«Все»":                {settings: `{"forwards":"all"}`, want: linked},
		"«Никто» — только имя": {settings: `{"forwards":"nobody"}`, want: nameOnly},
		"«Никто», но пересылающему «всегда»":  {settings: `{"forwards":"nobody"}`, exceptions: `{"forwards":true}`, want: linked},
		"«Все», но пересылающему «никогда»":   {settings: `{"forwards":"all"}`, exceptions: `{"forwards":false}`, want: nameOnly},
		"автор заблокировал пересылающего":    {blocked: true, want: nameOnly},
		"повреждённые настройки — только имя": {settings: `{broken`, want: nameOnly},
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			expectForwardSource(mock, `{}`)
			expectForwardsRule(mock, forwardAuthorID, tt.settings, tt.blocked, tt.exceptions)

			source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

			require.NoError(t, err)
			require.Equal(t, tt.want, source)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestForwardOriginWithoutRuleQuery(t *testing.T) {
	t.Run("своё сообщение — правило не спрашивается", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectQuery(forwardSourceQuery).WithArgs(messageValidationMessageID).
			WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Me", messageValidationUserID, []byte(`{}`)))
		mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

		source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

		require.NoError(t, err)
		require.Equal(t, ForwardSource{MessageID: messageValidationMessageID, SenderName: "Me"}, source)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("скрытый источник остаётся скрытым при следующей пересылке", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		// Имя — первоисточника, а не того, кто переслал: «Anna» не подставится.
		expectForwardSource(mock, `{"forwardedHidden":true,"forwardedSenderName":"Boris"}`)

		source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

		require.NoError(t, err)
		require.Equal(t, ForwardSource{SenderName: "Boris"}, source)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("автор первоисточника неизвестен — только имя", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		expectForwardSource(mock, `{"forwardedFrom":"`+forwardOriginalID+`","forwardedSenderName":"Boris"}`)
		mock.ExpectQuery(forwardOriginAuthorStmt).WithArgs(forwardOriginalID).WillReturnError(sql.ErrNoRows)

		source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, messageValidationMessageID)

		require.NoError(t, err)
		require.Equal(t, ForwardSource{SenderName: "Boris"}, source)
		require.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestForwardSourceApply(t *testing.T) {
	metadata := map[string]any{"forwardedFrom": "old", "forwardedHidden": true, "fileName": "a.pdf"}
	ForwardSource{MessageID: "new", SenderName: "Anna"}.Apply(metadata)
	require.Equal(t, map[string]any{"forwardedFrom": "new", "forwardedSenderName": "Anna", "fileName": "a.pdf"}, metadata)

	ForwardSource{SenderName: "Anna"}.Apply(metadata)
	require.Equal(t, map[string]any{"forwardedHidden": true, "forwardedSenderName": "Anna", "fileName": "a.pdf"}, metadata)
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
					WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", forwardAuthorID, []byte(`{}`)))
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

			source, err := NewService(db, nil, nil).ForwardOrigin(context.Background(), messageValidationUserID, tt.messageID)

			require.ErrorIs(t, err, tt.wantErr)
			require.Empty(t, source)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// sendForwarded отправляет зашифрованную пересылку через POST /messages и
// возвращает тело ответа. rule — ожидание правила «Пересылка».
func sendForwarded(t *testing.T, rule func(sqlmock.Sqlmock), stored forwardMetadataArg, storedJSON string) string {
	t.Helper()
	handler, mock := messageValidationHandler(t)
	expectForwardSource(mock, `{}`)
	rule(mock)
	mock.ExpectQuery(`SELECT cm\.role`).
		WithArgs(messageValidationChatID, messageValidationUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", false))
	mock.ExpectBegin()
	mock.ExpectQuery(`WITH inserted AS`).
		WithArgs(messageValidationChatID, messageValidationUserID, "forwarded text", "text", sql.NullString{}, stored).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "chat_id", "sender_id", "sender_name", "sender_avatar",
			"content", "type", "reply_to", "metadata", "is_pinned", "is_edited",
			"created_at", "updated_at", "deleted_at",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440020", messageValidationChatID, messageValidationUserID, "Alice", "",
			"forwarded text", "text", nil, []byte(storedJSON), false, false,
			"2026-09-24T00:00:00Z", "2026-09-24T00:00:00Z", nil,
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
	require.NoError(t, mock.ExpectationsWereMet())
	return recorder.Body.String()
}

type forwardedResponse struct {
	Message struct {
		IsForwarded         bool           `json:"isForwarded"`
		ForwardedSenderName string         `json:"forwardedSenderName"`
		Metadata            map[string]any `json:"metadata"`
	} `json:"message"`
}

func TestSendMessageStoresForwardedFrom(t *testing.T) {
	body := sendForwarded(t,
		func(mock sqlmock.Sqlmock) { expectForwardsRule(mock, forwardAuthorID, "", false, "") },
		forwardMetadataArg{from: messageValidationMessageID, name: "Anna"},
		`{"forwardedFrom":"`+messageValidationMessageID+`","forwardedSenderName":"Anna"}`)

	var response forwardedResponse
	require.NoError(t, json.Unmarshal([]byte(body), &response))
	require.True(t, response.Message.IsForwarded)
	require.Equal(t, "Anna", response.Message.ForwardedSenderName, "имя — с сервера, не из запроса")
}

// Автор запретил пересылку со ссылкой (#785): в ответе нет ни исходного
// сообщения, ни автора — только имя.
func TestSendMessageHidesForwardedFromWhenAuthorForbids(t *testing.T) {
	body := sendForwarded(t,
		func(mock sqlmock.Sqlmock) {
			expectForwardsRule(mock, forwardAuthorID, `{"forwards":"nobody"}`, false, "")
		},
		forwardMetadataArg{name: "Anna"},
		`{"forwardedHidden":true,"forwardedSenderName":"Anna"}`)

	var response forwardedResponse
	require.NoError(t, json.Unmarshal([]byte(body), &response))
	require.True(t, response.Message.IsForwarded)
	require.Equal(t, "Anna", response.Message.ForwardedSenderName)
	require.NotContains(t, body, messageValidationMessageID)
	require.NotContains(t, body, forwardAuthorID)
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
					WillReturnRows(sqlmock.NewRows(forwardSourceColumns).AddRow(forwardSourceChatID, "Anna", forwardAuthorID, []byte(`{}`)))
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
			AddRow(messageValidationMessageID, forwardSourceChatID, forwardAuthorID, "Anna", "text", "text", nil, []byte(metadata), "created", "updated", nil))
	mock.ExpectQuery(forwardMembershipStmt).WithArgs(messageValidationUserID, forwardSourceChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(forwardOriginAuthorStmt).WithArgs(forwardOriginalID).
		WillReturnRows(sqlmock.NewRows([]string{"sender_id"}).AddRow(forwardOriginalAuthorID))
	expectForwardsRule(mock, forwardOriginalAuthorID, "", false, "")
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
