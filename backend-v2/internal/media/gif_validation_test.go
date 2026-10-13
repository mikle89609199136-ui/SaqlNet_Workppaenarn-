package media

import (
	"strings"
	"testing"
)

func TestParseGifMediaPath(t *testing.T) {
	const id = "abcdef01-2345-6789-abcd-ef0123456789"
	const path = "/api/v2/media/" + id
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"lowercase", path, id},
		{"uppercase UUID", "/api/v2/media/" + strings.ToUpper(id), strings.ToUpper(id)},
		{"empty", "", ""},
		{"spaces", "   ", ""},
		{"javascript", "javascript:alert(1)", ""},
		{"data", "data:text/html,<script>alert(1)</script>", ""},
		{"https", "https://example.com/a.gif", ""},
		{"http", "http://example.com/a.gif", ""},
		{"host", "//host" + path, ""},
		{"query", path + "?x=1", ""},
		{"fragment", path + "#f", ""},
		{"trailing slash", path + "/", ""},
		{"extra segment", path + "/extra", ""},
		{"double slash", "/api/v2/media//" + id, ""},
		{"trailing dots", path + "..", ""},
		{"parent segment", "/api/v2/media/../" + id, ""},
		{"not UUID", "/api/v2/media/not-a-uuid", ""},
		{"no hyphens", "/api/v2/media/" + strings.ReplaceAll(id, "-", ""), ""},
		{"too long", path + strings.Repeat("a", maxGifURLBytes), ""},
		{"uppercase prefix", strings.ToUpper(path), ""},
		{"surrounding spaces", " " + path + " ", ""},
		{"trailing newline", path + "\n", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseGifMediaPath(tt.raw)
			if got != tt.want || ok != (tt.want != "") {
				t.Fatalf("parseGifMediaPath()=(%q, %t), want (%q, %t)", got, ok, tt.want, tt.want != "")
			}
		})
	}
}

func TestValidateGifName(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{"empty", "", "", true},
		{"spaces", "   ", "", true},
		{"trim", "  подпись  ", "подпись", true},
		{"255 Cyrillic code points", strings.Repeat("я", 255), strings.Repeat("я", 255), true},
		{"256 code points", strings.Repeat("я", 256), "", false},
		{"NUL", "a\x00b", "", false},
		{"newline", "a\nb", "", false},
		{"tab", "a\tb", "", false},
		{"C1", "a\u0085b", "", false},
		{"DEL", "a\x7fb", "", false},
		{"invalid UTF-8", "a\xffb", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := validateGifName(tt.raw)
			if got != tt.want || ok != tt.ok {
				t.Fatalf("validateGifName()=(%q, %t), want (%q, %t)", got, ok, tt.want, tt.ok)
			}
		})
	}
}
