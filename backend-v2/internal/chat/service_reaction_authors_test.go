package chat

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// TestService_ListReactionAuthors_Validation verifies that every invalid input
// is rejected before the first SQL query is issued. The service and the
// database are wired together, but no mock expectations are set: if the
// service touched the database, ExpectationsWereMet would fail.
func TestService_ListReactionAuthors_Validation(t *testing.T) {
	const (
		viewerID  = "550e8400-e29b-41d4-a716-446655440001"
		messageID = "550e8400-e29b-41d4-a716-446655440002"
	)

	tests := []struct {
		name      string
		viewerID  string
		messageID string
		emoji     string
		cursor    string
	}{
		{name: "invalid messageID", viewerID: viewerID, messageID: "not-a-uuid", emoji: "👍"},
		{name: "invalid viewerID", viewerID: "not-a-uuid", messageID: messageID, emoji: "👍"},
		{name: "empty emoji", viewerID: viewerID, messageID: messageID, emoji: ""},
		{name: "emoji too long (65 bytes)", viewerID: viewerID, messageID: messageID, emoji: strings.Repeat("a", 65)},
		{name: "emoji with html-hostile char", viewerID: viewerID, messageID: messageID, emoji: "<x>"},
		{name: "emoji with slash", viewerID: viewerID, messageID: messageID, emoji: "a/b"},
		{name: "emoji with ampersand", viewerID: viewerID, messageID: messageID, emoji: "a&b"},
		{name: "malformed cursor (not base64)", viewerID: viewerID, messageID: messageID, emoji: "👍", cursor: "!!!not-base64!!!"},
		{name: "malformed cursor (not JSON)", viewerID: viewerID, messageID: messageID, emoji: "👍", cursor: "YWJj"},
		{name: "malformed cursor (missing fields)", viewerID: viewerID, messageID: messageID, emoji: "👍", cursor: "e30"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })

			svc := NewService(db, nil, nil)

			_, err = svc.ListReactionAuthors(t.Context(), tt.viewerID, tt.messageID, tt.emoji, tt.cursor, 0)
			require.ErrorIs(t, err, ErrInvalidInput)

			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
