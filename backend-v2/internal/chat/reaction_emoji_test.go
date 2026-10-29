package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"

	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"
)

func TestReactionEmojiBoundaries(t *testing.T) {
	tests := []struct{ name, input, want string }{
		{"пустое", "", ""},
		{"пробелы Unicode", " \t\n\u00a0\u2003\u3000", ""},
		{"текст", "not-emoji", ""},
		{"цифра", "1", ""},
		{"два emoji", "👍🔥", ""},
		{"внутренний пробел", "👍 🔥", ""},
		{"emoji и текст", "👍hi", ""},
		{"невидимый символ", "\u200b👍", ""},
		{"несколько selectors", "❤\ufe0e\ufe0f", ""},
		{"повторный selector", "❤\ufe0f\ufe0f", ""},
		{"неверный UTF-8", string([]byte{0xff}), ""},
		{"ZWJ вне whitelist", "👨‍👩‍👧‍👦", ""},
		{"тон кожи вне whitelist", "👍🏽", ""},
		{"флаг вне whitelist", "🇷🇺", ""},
		{"keycap вне whitelist", "1️⃣", ""},
		{"combining mark", "👍\u0301", ""},
		{"NFC текст", "é", ""},
		{"NFD текст", "e\u0301", ""},
		{"разделители строк Unicode", "\u2028👍\u2029", "👍"},
		{"обычный emoji", "👍", "👍"},
		{"сердце без selector", "❤", "❤️"},
		{"текстовый selector", "❤︎", "❤️"},
		{"emoji selector", "❤️", "❤️"},
		{"selector у обычного emoji", "👍️", "👍"},
		{"окружающие пробелы", "\t\u00a0 ❤️\u3000\n", "❤️"},
		{"ровно 64 байта", strings.Repeat(" ", 60) + "👍", "👍"},
		{"65 байт", strings.Repeat(" ", 61) + "👍", ""},
		{"64 байта Unicode", strings.Repeat("\u3000", 20) + "👍", "👍"},
		{"67 байт Unicode", strings.Repeat("\u3000", 21) + "👍", ""},
	}
	// Check the same input language declared for the real POST route.
	data, err := os.ReadFile("../../contracts/openapi/paths/messages.yaml")
	require.NoError(t, err)
	var paths struct {
		Reactions struct {
			Post struct {
				RequestBody struct {
					Content map[string]struct {
						Schema struct {
							Properties map[string]struct {
								Pattern  string
								MaxBytes int `yaml:"x-maxUtf8Bytes"`
							}
						}
					}
				} `yaml:"requestBody"`
			}
		} `yaml:"/messages/{messageId}/reactions"`
	}
	require.NoError(t, yaml.Unmarshal(data, &paths))
	schema := paths.Reactions.Post.RequestBody.Content["application/json"].Schema.Properties["emoji"]
	require.Equal(t, 64, schema.MaxBytes)
	unicodeEscape := regexp.MustCompile(`\\u([0-9a-fA-F]{4})`)
	pattern, err := regexp.Compile(unicodeEscape.ReplaceAllString(schema.Pattern, `\x{$1}`))
	require.NoError(t, err)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := canonicalReactionEmoji(tc.input)
			require.Equal(t, tc.want, got)
			require.Equal(t, tc.want == "", err != nil)
			require.Equal(t, tc.want != "", len(tc.input) <= schema.MaxBytes && pattern.MatchString(tc.input))
			if tc.want == "" {
				// No SQL expectations: invalid input must be rejected before DB access.
				db, mock, service, ws := setupTest(t)
				defer db.Close()
				body, marshalErr := json.Marshal(map[string]string{"emoji": tc.input})
				require.NoError(t, marshalErr)
				req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/550e8400-e29b-41d4-a716-446655440003/reactions", strings.NewReader(string(body)))
				req = req.WithContext(authctx.WithUser(req.Context(), authctx.User{ID: "550e8400-e29b-41d4-a716-446655440001"}))
				w := httptest.NewRecorder()
				NewHandler(service).Messages(w, req)
				require.Equal(t, http.StatusBadRequest, w.Code)
				require.False(t, ws.BroadcastToChatCalled)
				require.NoError(t, mock.ExpectationsWereMet())
				_, _, _, serviceErr := service.ToggleReaction(context.Background(), "user", "message", tc.input)
				require.ErrorIs(t, serviceErr, ErrInvalidInput)
			}
		})
	}
	for canonical := range strings.FieldsSeq(reactionEmojis) {
		for _, input := range []string{canonical, strings.TrimSuffix(canonical, "\ufe0f"), " \t" + canonical + "\u00a0"} {
			got, err := canonicalReactionEmoji(input)
			require.NoError(t, err)
			require.Equal(t, canonical, got)
			require.True(t, pattern.MatchString(input), "schema rejects %q", input)
		}
	}
}
