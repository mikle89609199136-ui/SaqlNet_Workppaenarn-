package chat

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMessageEntitiesValidation(t *testing.T) {
	entity := func(kind string, offset, length int) string {
		return fmt.Sprintf(`[{"type":%q,"offset":%d,"length":%d}]`, kind, offset, length)
	}
	link := func(url string) string {
		raw, _ := json.Marshal(url)
		return `[{"type":"link","offset":0,"length":1,"data":{"url":` + string(raw) + `}}]`
	}
	encrypted := `{"v":2,"e2e":true,"iv":"abc","data":"` + strings.Repeat("x", 17000) + `"}`
	tests := []struct {
		name, content, raw string
		invalid            bool
	}{
		{"absent", "x", "", false},
		{"empty", "x", "[]", false},
		{"null array", "x", "null", true},
		{"object", "x", "{}", true},
		{"null entity", "x", "[null]", true},
		{"missing type", "x", `[{"offset":0,"length":1}]`, true},
		{"missing offset", "x", `[{"type":"bold","length":1}]`, true},
		{"missing length", "x", `[{"type":"bold","offset":0}]`, true},
		{"null offset", "x", `[{"type":"bold","offset":null,"length":1}]`, true},
		{"fraction offset", "x", `[{"type":"bold","offset":0.5,"length":1}]`, true},
		{"fraction length", "x", `[{"type":"bold","offset":0,"length":1.5}]`, true},
		{"string offset", "x", `[{"type":"bold","offset":"0","length":1}]`, true},
		{"string length", "x", `[{"type":"bold","offset":0,"length":"1"}]`, true},
		{"negative offset", "x", entity("bold", -1, 1), true},
		{"zero length", "x", entity("bold", 0, 0), true},
		{"negative length", "x", entity("bold", 0, -1), true},
		{"overflow", "x", `[{"type":"bold","offset":1,"length":9223372036854775807}]`, true},
		{"cyrillic boundary", "Привет", entity("bold", 0, 6), false},
		{"cyrillic past end", "Привет", entity("bold", 0, 7), true},
		{"emoji", "a😀b", entity("bold", 1, 2), false},
		{"emoji start split", "a😀b", entity("bold", 2, 1), true},
		{"emoji end split", "a😀b", entity("bold", 1, 1), true},
		{"emoji end exact", "😀", entity("bold", 0, 2), false},
		{"emoji past end", "😀", entity("bold", 0, 3), true},
		{"grapheme", "👨‍👩‍👧", entity("bold", 0, 8), false},
		{"grapheme rune boundary", "👨‍👩‍👧", entity("bold", 2, 1), false},
		{"grapheme past end", "👨‍👩‍👧", entity("bold", 0, 9), true},
		{"newline", "a\nb", entity("bold", 1, 2), false},
		{"date", "x", entity("date", 0, 1), true},
		{"unknown", "x", entity("unknown", 0, 1), true},
		{"nonlink data", "x", `[{"type":"bold","offset":0,"length":1,"data":{}}]`, true},
		{"nonlink null data", "x", `[{"type":"bold","offset":0,"length":1,"data":null}]`, true},
		{"link missing data", "x", entity("link", 0, 1), true},
		{"link missing URL", "x", `[{"type":"link","offset":0,"length":1,"data":{}}]`, true},
		{"link null data", "x", `[{"type":"link","offset":0,"length":1,"data":null}]`, true},
		{"link numeric URL", "x", `[{"type":"link","offset":0,"length":1,"data":{"url":123}}]`, true},
		{"http", "x", link("http://example.com"), false},
		{"https", "x", link("https://example.com"), false},
		{"ftp", "x", link("ftp://example.com"), true},
		{"javascript", "x", link("javascript:alert(1)"), true},
		{"mailto", "x", link("mailto:a@example.com"), true},
		{"empty host", "x", link("https:///docs"), true},
		{"invalid URL", "x", link("https://example.com/%ZZ"), true},
		{"URL limit", "x", link("https://x/" + strings.Repeat("😀", 1019)), false},
		{"URL over limit", "x", link("https://x/" + strings.Repeat("😀", 1019) + "a"), true},
		{"100 entities", "x", "[" + strings.TrimSuffix(strings.Repeat(`{"type":"bold","offset":0,"length":1},`, 100), ",") + "]", false},
		{"101 entities", "x", "[" + strings.TrimSuffix(strings.Repeat(`{"type":"bold","offset":0,"length":1},`, 101), ",") + "]", true},
		{"overlapping links", "abc", `[{"type":"link","offset":0,"length":2,"data":{"url":"https://x"}},{"type":"link","offset":1,"length":2,"data":{"url":"http://x"}}]`, true},
		{"adjacent links", "abc", `[{"type":"link","offset":0,"length":1,"data":{"url":"https://x"}},{"type":"link","offset":1,"length":2,"data":{"url":"http://x"}}]`, false},
		{"inline overlaps", "abc", `[{"type":"bold","offset":0,"length":2},{"type":"italic","offset":1,"length":2},{"type":"link","offset":0,"length":3,"data":{"url":"https://x"}}]`, false},
		{"quote whole line", "ab\ncd\nef", entity("blockquote", 3, 2), false},
		{"quote multiline", "ab\ncd\nef", entity("blockquote", 0, 5), false},
		{"quote starts midline", "ab\ncd", entity("blockquote", 1, 1), true},
		{"quote ends midline", "ab\ncd", entity("blockquote", 0, 1), true},
		{"quotes overlap", "ab\ncd", `[{"type":"blockquote","offset":0,"length":5},{"type":"blockquote","offset":3,"length":2}]`, true},
		{"quotes disjoint", "ab\ncd", `[{"type":"blockquote","offset":0,"length":2},{"type":"blockquote","offset":3,"length":2}]`, false},
		{"inline inside", "ab\ncd\nef", `[{"type":"blockquote","offset":3,"length":2},{"type":"bold","offset":3,"length":1}]`, false},
		{"inline crosses start", "ab\ncd\nef", `[{"type":"blockquote","offset":3,"length":2},{"type":"bold","offset":2,"length":2}]`, true},
		{"inline crosses end reversed", "ab\ncd\nef", `[{"type":"bold","offset":4,"length":2},{"type":"blockquote","offset":3,"length":2}]`, true},
		{"inline surrounds quote", "ab\ncd\nef", `[{"type":"bold","offset":0,"length":8},{"type":"blockquote","offset":3,"length":2}]`, true},
		{"content limit", strings.Repeat("😀", 8192), "[]", false},
		{"content over limit", strings.Repeat("😀", 8192) + "a", "[]", true},
		{"encrypted long", encrypted, "[]", false},
		{"encrypted entities", encrypted, entity("bold", 0, 1), true},
	}
	for _, kind := range []string{"bold", "italic", "underline", "strikethrough", "spoiler", "monospace", "blockquote"} {
		tests = append(tests, struct {
			name, content, raw string
			invalid            bool
		}{kind, "x", entity(kind, 0, 1), false})
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseMessageEntities(tc.content, json.RawMessage(tc.raw))
			if tc.invalid {
				require.ErrorIs(t, err, ErrInvalidInput)
				require.Regexp(t, "content|entities", err.Error())
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestContentLimitPrecedesEntitiesSchema(t *testing.T) {
	_, err := parseMessageEntities(strings.Repeat("x", 16385), json.RawMessage(`{}`))
	require.ErrorContains(t, err, "content")
}

func TestEmptyMessageEntitiesJSON(t *testing.T) {
	for _, value := range []any{Message{}, LastMessagePreview{}} {
		raw, err := json.Marshal(value)
		require.NoError(t, err)
		require.Contains(t, string(raw), `"entities":[]`)
	}
}
