package chat

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	toggleTestUserID    = "550e8400-e29b-41d4-a716-446655440003"
	toggleTestMessageID = "550e8400-e29b-41d4-a716-446655440002"
	toggleTestChatID    = "550e8400-e29b-41d4-a716-446655440001"
)

func expectToggleReactionPrelude(mock sqlmock.Sqlmock, currentEmoji *string) {
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(toggleTestMessageID).WillReturnRows(
		sqlmock.NewRows([]string{"chat_id"}).AddRow(toggleTestChatID),
	)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(toggleTestUserID, toggleTestChatID).WillReturnRows(
		sqlmock.NewRows([]string{"exists"}).AddRow(true),
	)
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(toggleTestMessageID, toggleTestUserID)).WillReturnResult(sqlmock.NewResult(0, 0))

	currentQuery := mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(toggleTestMessageID, toggleTestUserID)
	if currentEmoji == nil {
		currentQuery.WillReturnError(sql.ErrNoRows)
		return
	}
	currentQuery.WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(*currentEmoji))
}

func TestToggleReaction_ZeroRowsAffectedRollsBack(t *testing.T) {
	testCases := []struct {
		name         string
		currentEmoji *string
		selected     string
		expectExec   func(sqlmock.Sqlmock)
	}{
		{
			name:         "insert",
			currentEmoji: nil,
			selected:     "👍",
			expectExec: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(toggleTestMessageID, toggleTestUserID, "👍").WillReturnResult(sqlmock.NewResult(0, 0))
			},
		},
		{
			name:         "delete",
			currentEmoji: stringPointer("👍"),
			selected:     "👍",
			expectExec: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec(regexp.QuoteMeta(
					`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(toggleTestMessageID, toggleTestUserID).WillReturnResult(sqlmock.NewResult(0, 0))
			},
		},
		{
			name:         "update",
			currentEmoji: stringPointer("👍"),
			selected:     "❤️",
			expectExec: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec(regexp.QuoteMeta(
					`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
				)).WithArgs("❤️", toggleTestMessageID, toggleTestUserID).WillReturnResult(sqlmock.NewResult(0, 0))
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, service, ws := setupTest(t)
			defer db.Close()

			expectToggleReactionPrelude(mock, tc.currentEmoji)
			tc.expectExec(mock)
			mock.ExpectRollback()

			_, _, _, err := service.ToggleReaction(
				context.Background(), toggleTestUserID, toggleTestMessageID, tc.selected,
			)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "expected 1 affected row, got 0")
			assert.Equal(t, 0, ws.BroadcastToChatCount)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestToggleReaction_CommitErrorDoesNotBroadcast(t *testing.T) {
	db, mock, service, ws := setupTest(t)
	defer db.Close()

	expectToggleReactionPrelude(mock, nil)
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(toggleTestMessageID, toggleTestUserID, "👍").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(toggleTestMessageID, toggleTestUserID).WillReturnRows(
		sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).AddRow("👍", 1, true),
	)
	mock.ExpectCommit().WillReturnError(errors.New("commit failed"))

	_, _, _, err := service.ToggleReaction(
		context.Background(), toggleTestUserID, toggleTestMessageID, "👍",
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "commit transaction")
	assert.Equal(t, 0, ws.BroadcastToChatCount)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func stringPointer(value string) *string {
	return &value
}
