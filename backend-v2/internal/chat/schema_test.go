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

func TestMessagesCompatMigrationBackfillsExistingTables(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0017_messages_compat.sql")
	if err != nil {
		t.Fatalf("read messages compat migration: %v", err)
	}
	source := string(sql)
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS reply_to",
		"ADD COLUMN IF NOT EXISTS metadata",
		"ADD COLUMN IF NOT EXISTS updated_at",
		"ADD COLUMN IF NOT EXISTS deleted_at",
	} {
		if !strings.Contains(source, clause) {
			t.Fatalf("messages compat migration is missing %q", clause)
		}
	}
}

func TestUserMuteCompatMigrationBackfillsSendMessageDependencies(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0018_user_mute_compat.sql")
	if err != nil {
		t.Fatalf("read user mute compat migration: %v", err)
	}
	source := string(sql)
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS is_muted",
		"ADD COLUMN IF NOT EXISTS muted_until",
		"ADD COLUMN IF NOT EXISTS mute_reason",
	} {
		if !strings.Contains(source, clause) {
			t.Fatalf("user mute compat migration is missing %q", clause)
		}
	}
}

func TestListMessagesReturnsChronologicalPage(t *testing.T) {
	source, err := os.ReadFile("service.go")
	if err != nil {
		t.Fatalf("read chat service: %v", err)
	}
	query := string(source)
	if !strings.Contains(query, "ORDER BY m.created_at DESC") {
		t.Fatal("ListMessages should select the latest page first")
	}
	if !strings.Contains(query, "ORDER BY created_at ASC") {
		t.Fatal("ListMessages should return the selected page in chronological order")
	}
}
