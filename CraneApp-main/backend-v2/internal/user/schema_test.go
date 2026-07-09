package user

import (
	"os"
	"strings"
	"testing"
)

func TestUserSessionsMigrationExists(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0003_users.sql")
	if err != nil {
		t.Fatalf("read user migration: %v", err)
	}
	source := string(sql)
	for _, fragment := range []string{
		"CREATE TABLE IF NOT EXISTS public.user_sessions",
		"device_name TEXT",
		"is_current BOOLEAN",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("user sessions migration is missing %q", fragment)
		}
	}
}
