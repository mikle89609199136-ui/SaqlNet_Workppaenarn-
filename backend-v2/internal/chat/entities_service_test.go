package chat

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func entityMessageRows(content, entities string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "chat_id", "sender_id", "sender_name", "sender_avatar", "content", "entities", "type", "reply_to", "metadata", "is_pinned", "is_edited", "created_at", "updated_at", "deleted_at"}).AddRow(messageValidationMessageID, messageValidationChatID, messageValidationUserID, "Alice", "", content, []byte(entities), "text", nil, []byte("{}"), false, false, "created", "updated", nil)
}

func TestSendEntitiesPreservesContentAndBroadcast(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	ws := &recordingRealtime{}
	handler := NewHandler(NewService(db, ws, nil))
	content := `a & b <i>x</i> "q"`
	entities := `[{"type":"bold","offset":0,"length":1},{"type":"link","offset":4,"length":1,"data":{"url":"https://example.com/docs"}}]`
	mock.ExpectQuery(`SELECT cm\.role`).WithArgs(messageValidationChatID, messageValidationUserID).WillReturnRows(sqlmock.NewRows([]string{"role", "muted", "blocked_by_peer"}).AddRow("member", false, false))
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO messages\.messages .*entities`).WithArgs(messageValidationChatID, messageValidationUserID, content, "text", sql.NullString{}, []byte("null"), 0, []byte(entities)).WillReturnRows(entityMessageRows(content, entities))
	mock.ExpectCommit()
	body, err := json.Marshal(map[string]any{"content": content, "entities": json.RawMessage(entities)})
	require.NoError(t, err)
	rr := httptest.NewRecorder()
	handler.SendMessage(rr, messageValidationRequest(http.MethodPost, "/api/v2/messages/"+messageValidationChatID, sendBody(string(body)), "chatId", messageValidationChatID))
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	var response struct {
		Messages []Message `json:"messages"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	require.Len(t, response.Messages, 1)
	require.Equal(t, content, response.Messages[0].Content)
	raw, err := json.Marshal(response.Messages[0].Entities)
	require.NoError(t, err)
	require.JSONEq(t, entities, string(raw))
	require.Len(t, ws.broadcasts, 1)
	var event struct {
		Type    string  `json:"type"`
		Message Message `json:"message"`
	}
	require.NoError(t, json.Unmarshal(ws.broadcasts[0].payload, &event))
	require.Equal(t, "new_message", event.Type)
	require.Equal(t, response.Messages[0].Entities, event.Message.Entities)
	require.Equal(t, content, event.Message.Content)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEditReplacesOrClearsEntities(t *testing.T) {
	for _, tc := range []struct{ name, field, want string }{
		{"replace", `,"entities":[{"type":"italic","offset":0,"length":1}]`, `[{"type":"italic","offset":0,"length":1}]`},
		{"absent clears", "", "[]"},
		{"empty clears", `,"entities":[]`, "[]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			ws := &recordingRealtime{}
			handler := NewHandler(NewService(db, ws, nil))
			content := "x & <i>y</i>"
			mock.ExpectQuery(`SELECT m\.type`).WithArgs(messageValidationMessageID, messageValidationUserID).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("text"))
			mock.ExpectQuery(`SET content = \$1, entities = \$4`).WithArgs(content, messageValidationMessageID, messageValidationUserID, []byte(tc.want)).WillReturnRows(entityMessageRows(content, tc.want))
			rr := httptest.NewRecorder()
			handler.EditMessage(rr, messageValidationRequest(http.MethodPut, "/api/v2/messages/"+messageValidationMessageID, `{"content":"`+content+`"`+tc.field+`}`, "messageId", messageValidationMessageID))
			require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
			var response Message
			require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
			require.Equal(t, content, response.Content)
			raw, err := json.Marshal(response.Entities)
			require.NoError(t, err)
			require.JSONEq(t, tc.want, string(raw))
			require.Len(t, ws.broadcasts, 1)
			var event struct {
				Type     string          `json:"type"`
				Entities json.RawMessage `json:"entities"`
			}
			require.NoError(t, json.Unmarshal(ws.broadcasts[0].payload, &event))
			require.Equal(t, "message_edited", event.Type)
			require.JSONEq(t, tc.want, string(event.Entities))
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestInvalidEntitiesHaveNoSideEffects(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `[null]`, `[{"type":"bold","length":1}]`, `[{"type":"bold","offset":"0","length":1}]`, `[{"type":"bold","offset":0,"length":0.5}]`, `[{"type":"bold","offset":0,"length":1,"data":null}]`, `[{"type":"link","offset":0,"length":1,"data":{"url":"javascript:alert(1)"}}]`} {
		for _, edit := range []bool{false, true} {
			t.Run(raw+map[bool]string{true: " edit", false: " send"}[edit], func(t *testing.T) {
				db, mock, err := sqlmock.New()
				require.NoError(t, err)
				defer db.Close()
				ws := &recordingRealtime{}
				h := NewHandler(NewService(db, ws, nil))
				rr := httptest.NewRecorder()
				body := `{"content":"hello","entities":` + raw + `}`
				if edit {
					h.EditMessage(rr, messageValidationRequest(http.MethodPut, "/", body, "messageId", messageValidationMessageID))
				} else {
					h.SendMessage(rr, messageValidationRequest(http.MethodPost, "/", sendBody(body), "chatId", messageValidationChatID))
				}
				assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
				require.Contains(t, rr.Body.String(), "entities")
				require.Empty(t, ws.broadcasts)
				require.NoError(t, mock.ExpectationsWereMet())
			})
		}
	}
}

func TestServiceValidatesBeforeDatabase(t *testing.T) {
	for _, tc := range []struct {
		content, kind string
		entities      MessageEntities
	}{
		{strings.Repeat("x", 16385), "text", nil},
		{"😀", "text", MessageEntities{{Type: "bold", Offset: 0, Length: 1}}},
		{`{"e2e":true,"iv":"x","data":"x"}`, "text", MessageEntities{{Type: "bold", Offset: 0, Length: 1}}},
		{"", "sticker", MessageEntities{{Type: "bold", Offset: 0, Length: 1}}},
	} {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		ws := &recordingRealtime{}
		svc := NewService(db, ws, nil)
		_, err = svc.SendMessages(t.Context(), "user", "chat", []OutgoingMessage{{Content: tc.content, Type: tc.kind, Entities: tc.entities}})
		require.ErrorIs(t, err, ErrInvalidInput)
		_, err = svc.EditMessage(t.Context(), "user", "message", tc.content, tc.entities)
		require.ErrorIs(t, err, ErrInvalidInput)
		require.Empty(t, ws.broadcasts)
		require.NoError(t, mock.ExpectationsWereMet())
		db.Close()
	}
}

func TestLegacyMessageDefaultEntitiesInListResponse(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT ").WillReturnRows(entityMessageRows("legacy &amp; text", "[]"))
	mock.ExpectQuery("SELECT message_id::text").WillReturnRows(sqlmock.NewRows([]string{"message_id", "emoji", "count", "my_reaction"}))
	h := NewHandler(NewService(db, nil, nil))
	rr := httptest.NewRecorder()
	h.ListMessages(rr, messageValidationRequest(http.MethodGet, "/", "", "chatId", messageValidationChatID))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var response struct {
		Messages []Message `json:"messages"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	require.Len(t, response.Messages, 1)
	require.Equal(t, "legacy &amp; text", response.Messages[0].Content)
	require.NotNil(t, response.Messages[0].Entities)
	require.Empty(t, response.Messages[0].Entities)
	require.Contains(t, rr.Body.String(), `"entities":[]`)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendStickerEntitiesRejected(t *testing.T) {
	h, mock := messageValidationHandler(t)
	ws := &recordingRealtime{}
	h.service.ws = ws
	rr := httptest.NewRecorder()
	h.SendMessage(rr, messageValidationRequest(http.MethodPost, "/", sendBody(`{"type":"sticker","content":"x","mediaUrl":"/sticker","entities":[{"type":"bold","offset":0,"length":1}]}`), "chatId", messageValidationChatID))
	assertErrorResponse(t, rr, http.StatusBadRequest, "validation_failed")
	require.Contains(t, rr.Body.String(), "entities")
	require.Empty(t, ws.broadcasts)
	require.NoError(t, mock.ExpectationsWereMet())
}
