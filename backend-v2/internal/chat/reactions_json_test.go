package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestMessageReactionsJSONContract(t *testing.T) {
	for _, tc := range []struct {
		name      string
		reactions MessageReactions
		want      string
	}{
		{"nil", nil, `[]`},
		{"empty", MessageReactions{}, `[]`},
		{"populated", MessageReactions{{Emoji: "👍", Count: 2, MyReaction: true}}, `[{"emoji":"👍","count":2,"myReaction":true}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msg := Message{ID: "message", Reactions: tc.reactions, ReplyPreview: &LastMessagePreview{Reactions: tc.reactions}}
			for _, value := range []any{msg, &msg, forBroadcast(&msg)} {
				raw, err := json.Marshal(value)
				require.NoError(t, err)
				var response struct {
					Reactions    json.RawMessage `json:"reactions"`
					ReplyPreview struct {
						Reactions json.RawMessage `json:"reactions"`
					} `json:"replyPreview"`
				}
				require.NoError(t, json.Unmarshal(raw, &response))
				require.JSONEq(t, tc.want, string(response.Reactions))
				require.JSONEq(t, tc.want, string(response.ReplyPreview.Reactions))
			}
		})
	}
}

func TestSearchAndFavoritesArrayContract(t *testing.T) {
	for _, path := range []string{"search?q=hello", "favorites"} {
		for _, empty := range []bool{true, false} {
			name := path + "/populated"
			if empty {
				name = path + "/empty"
			}
			t.Run(name, func(t *testing.T) {
				h, mock := messageValidationHandler(t)
				rows := entityMessageRows("hello", "[]")
				if empty {
					rows = sqlmock.NewRows([]string{"id"})
				}
				mock.ExpectQuery("SELECT m.id::text").WillReturnRows(rows)
				rr := httptest.NewRecorder()
				h.Messages(rr, messageValidationRequest(http.MethodGet, "/api/v2/messages/"+path, "", "", ""))
				require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
				var response struct {
					Messages []struct {
						Reactions json.RawMessage `json:"reactions"`
					} `json:"messages"`
				}
				require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
				require.NotNil(t, response.Messages)
				if empty {
					require.Empty(t, response.Messages)
				} else {
					require.Len(t, response.Messages, 1)
					require.JSONEq(t, `[]`, string(response.Messages[0].Reactions))
				}
				require.NoError(t, mock.ExpectationsWereMet())
			})
		}
	}
}
