package chat

import (
	"os"
	"strings"
	"testing"
)

func TestMessagesMigrationMatchesServiceQueries(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0004_chats.sql")
	if err != nil {
		t.Fatalf("read chat migration: %v", err)
	}
	source := string(sql)
	for _, column := range []string{
		"reply_to UUID",
		"metadata JSONB",
		"updated_at TIMESTAMPTZ",
	} {
		if !strings.Contains(source, column) {
			t.Fatalf("messages migration is missing %q", column)
		}
	}
}
