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

type MockRealtimeServer struct {
	BroadcastToChatCalled  bool
	BroadcastToChatCount   int
	BroadcastToChatChatID  string
	BroadcastToChatMessage []byte
	BroadcastToChatExclude string

	BroadcastToUsersCalled bool
	BroadcastToUsersCount  int
	BroadcastToUsersIDs    []string
	BroadcastToUsersMsg    []byte

	IsUserConnectedCalled bool
	IsUserConnectedResult bool
	IsUserConnectedID     string

	CallRoomsCalled bool
}

func (m *MockRealtimeServer) CallRooms() *CallRoomManager {
	m.CallRoomsCalled = true
	return nil
}

func (m *MockRealtimeServer) IsUserConnected(userID string) bool {
	m.IsUserConnectedCalled = true
	m.IsUserConnectedID = userID
	return m.IsUserConnectedResult
}

func (m *MockRealtimeServer) BroadcastToChat(chatID string, message []byte, excludeUserID string) {
	m.BroadcastToChatCalled = true
	m.BroadcastToChatCount++
	m.BroadcastToChatChatID = chatID
	m.BroadcastToChatMessage = message
	m.BroadcastToChatExclude = excludeUserID
}

func (m *MockRealtimeServer) BroadcastToUsers(userIDs []string, message []byte) {
	m.BroadcastToUsersCalled = true
	m.BroadcastToUsersCount++
	m.BroadcastToUsersIDs = userIDs
	m.BroadcastToUsersMsg = message
}

func setupTest(t *testing.T) (*sql.DB, sqlmock.Sqlmock, *Service, *MockRealtimeServer) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)

	ws := &MockRealtimeServer{}

	service := &Service{
		db: db,
		ws: ws,
	}

	return db, mock, service, ws
}

func TestToggleReaction_Scenarios(t *testing.T) {
	testCases := []struct {
		name              string
		initialEmoji      string
		toggleEmoji       string
		expectedStatus    ReactionStatus
		expectedCurrent   string
		expectedReactions []Reaction
		setupMock         func(mock sqlmock.Sqlmock, messageID, userID, chatID, initialEmoji, toggleEmoji string)
	}{
		{
			name:              "no reaction → add",
			initialEmoji:      "",
			toggleEmoji:       "👍",
			expectedStatus:    StatusAdded,
			expectedCurrent:   "👍",
			expectedReactions: []Reaction{{Emoji: "👍", Count: 1, MyReaction: true}},
			setupMock: func(mock sqlmock.Sqlmock, messageID, userID, chatID, initialEmoji, toggleEmoji string) {
				mock.ExpectBegin()

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				mock.ExpectExec(regexp.QuoteMeta(
					`SELECT pg_advisory_xact_lock($1)`,
				)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, toggleEmoji).WillReturnResult(sqlmock.NewResult(1, 1))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).AddRow(toggleEmoji, 1, true))

				mock.ExpectCommit()
			},
		},
		{
			name:              "same emoji → remove",
			initialEmoji:      "👍",
			toggleEmoji:       "👍",
			expectedStatus:    StatusRemoved,
			expectedCurrent:   "",
			expectedReactions: []Reaction{},
			setupMock: func(mock sqlmock.Sqlmock, messageID, userID, chatID, initialEmoji, toggleEmoji string) {
				mock.ExpectBegin()

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				mock.ExpectExec(regexp.QuoteMeta(
					`SELECT pg_advisory_xact_lock($1)`,
				)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(initialEmoji))

				mock.ExpectExec(regexp.QuoteMeta(
					`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}))
				mock.ExpectCommit()
			},
		},
		{
			name:              "different emoji → replace",
			initialEmoji:      "👍",
			toggleEmoji:       "❤️",
			expectedStatus:    StatusReplaced,
			expectedCurrent:   "❤️",
			expectedReactions: []Reaction{{Emoji: "❤️", Count: 1, MyReaction: true}},
			setupMock: func(mock sqlmock.Sqlmock, messageID, userID, chatID, initialEmoji, toggleEmoji string) {
				mock.ExpectBegin()

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				mock.ExpectExec(regexp.QuoteMeta(
					`SELECT pg_advisory_xact_lock($1)`,
				)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(initialEmoji))

				mock.ExpectExec(regexp.QuoteMeta(
					`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
				)).WithArgs(toggleEmoji, messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).AddRow(toggleEmoji, 1, true))

				mock.ExpectCommit()
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()

			userID := "550e8400-e29b-41d4-a716-446655440003"
			messageID := "550e8400-e29b-41d4-a716-446655440003"
			chatID := "550e8400-e29b-41d4-a716-446655440001"

			db, mock, service, ws := setupTest(t)
			defer db.Close()

			tc.setupMock(mock, messageID, userID, chatID, tc.initialEmoji, tc.toggleEmoji)

			status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, tc.toggleEmoji)

			require.NoError(t, err)
			assert.Equal(t, tc.expectedStatus, status)
			assert.Equal(t, tc.expectedCurrent, currentEmoji)
			assert.Equal(t, len(tc.expectedReactions), len(reactions))
			for i, expected := range tc.expectedReactions {
				assert.Equal(t, expected.Emoji, reactions[i].Emoji)
				assert.Equal(t, expected.Count, reactions[i].Count)
				assert.Equal(t, expected.MyReaction, reactions[i].MyReaction)
			}

			assert.True(t, ws.BroadcastToChatCalled)
			assert.Equal(t, chatID, ws.BroadcastToChatChatID)

			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestToggleReaction_AfterReplacement_OnlyOneUserReaction(t *testing.T) {
	ctx := context.Background()

	userID := "550e8400-e29b-41d4-a716-446655440003"
	messageID := "550e8400-e29b-41d4-a716-446655440003"
	chatID := "550e8400-e29b-41d4-a716-446655440001"
	oldEmoji := "👍"
	newEmoji := "❤️"

	db, mock, service, ws := setupTest(t)
	defer db.Close()

	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(oldEmoji))

	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
	)).WithArgs(newEmoji, messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("❤️", 1, true).
		AddRow("😊", 2, false).
		AddRow("👍", 3, false))

	mock.ExpectCommit()

	status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, newEmoji)

	require.NoError(t, err)
	assert.Equal(t, StatusReplaced, status)
	assert.Equal(t, newEmoji, currentEmoji)

	var myReactionsCount int
	var userEmoji string
	for _, r := range reactions {
		if r.MyReaction {
			myReactionsCount++
			userEmoji = r.Emoji
		}
	}
	assert.Equal(t, 1, myReactionsCount,
		"User should have exactly ONE reaction on a message, but found %d", myReactionsCount)
	assert.Equal(t, newEmoji, userEmoji,
		"User's only reaction should be the new emoji (%s), but got %s", newEmoji, userEmoji)

	assert.Len(t, reactions, 3, "Should have 3 distinct emojis with reactions")
	assert.Equal(t, "❤️", reactions[0].Emoji)
	assert.Equal(t, 1, reactions[0].Count)
	assert.True(t, reactions[0].MyReaction, "User should have myReaction=true for their reaction (❤️)")
	assert.Equal(t, "😊", reactions[1].Emoji)
	assert.Equal(t, 2, reactions[1].Count)
	assert.False(t, reactions[1].MyReaction, "User should have myReaction=false for reactions they didn't make (😊)")
	assert.Equal(t, "👍", reactions[2].Emoji)
	assert.Equal(t, 3, reactions[2].Count)
	assert.False(t, reactions[2].MyReaction, "User should have myReaction=false for reactions they didn't make (👍)")

	assert.True(t, ws.BroadcastToChatCalled)
	assert.Equal(t, chatID, ws.BroadcastToChatChatID)

	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestToggleReaction_AggregatedCountsCorrect(t *testing.T) {
	ctx := context.Background()

	userID := "550e8400-e29b-41d4-a716-446655440003"
	messageID := "550e8400-e29b-41d4-a716-446655440003"
	chatID := "550e8400-e29b-41d4-a716-446655440001"
	emoji := "👍"

	db, mock, service, ws := setupTest(t)
	defer db.Close()

	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("👍", 5, true).
		AddRow("❤️", 3, false).
		AddRow("😊", 1, false))

	mock.ExpectCommit()

	status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, emoji)

	require.NoError(t, err)
	assert.Equal(t, StatusAdded, status)
	assert.Equal(t, emoji, currentEmoji)

	assert.Len(t, reactions, 3)

	assert.GreaterOrEqual(t, reactions[0].Count, reactions[1].Count)
	assert.GreaterOrEqual(t, reactions[1].Count, reactions[2].Count)

	assert.Equal(t, "👍", reactions[0].Emoji)
	assert.Equal(t, 5, reactions[0].Count)
	assert.True(t, reactions[0].MyReaction)

	assert.Equal(t, "❤️", reactions[1].Emoji)
	assert.Equal(t, 3, reactions[1].Count)
	assert.False(t, reactions[1].MyReaction)

	assert.Equal(t, "😊", reactions[2].Emoji)
	assert.Equal(t, 1, reactions[2].Count)
	assert.False(t, reactions[2].MyReaction)

	total := 0
	for _, r := range reactions {
		total += r.Count
	}
	assert.Equal(t, 9, total)

	for _, r := range reactions {
		assert.Greater(t, r.Count, 0)
	}

	var myCount int
	for _, r := range reactions {
		if r.MyReaction {
			myCount++
			assert.Equal(t, emoji, r.Emoji)
		}
	}
	assert.Equal(t, 1, myCount)

	assert.True(t, ws.BroadcastToChatCalled)
	assert.Equal(t, chatID, ws.BroadcastToChatChatID)

	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestToggleReaction_WebSocketBroadcast(t *testing.T) {
	testCases := []struct {
		name              string
		shouldSucceed     bool
		expectedCallCount int
	}{
		{"success → broadcast once", true, 1},
		{"rollback → no broadcast", false, 0},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			userID := "550e8400-e29b-41d4-a716-446655440003"
			messageID := "550e8400-e29b-41d4-a716-446655440003"
			chatID := "550e8400-e29b-41d4-a716-446655440001"
			emoji := "👍"

			db, mock, service, ws := setupTest(t)
			defer db.Close()

			mock.ExpectBegin()

			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
			)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
			)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

			mock.ExpectExec(regexp.QuoteMeta(
				`SELECT pg_advisory_xact_lock($1)`,
			)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
			)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

			if tc.shouldSucceed {
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
					AddRow("👍", 1, true))

				mock.ExpectCommit()
			} else {
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, emoji).WillReturnError(errors.New("insert error"))
				mock.ExpectRollback()
			}

			_, _, _, err := service.ToggleReaction(ctx, userID, messageID, emoji)

			if tc.shouldSucceed {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}

			assert.Equal(t, tc.expectedCallCount, ws.BroadcastToChatCount)

			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestToggleReaction_DoubleCalls_NoDuplicateReactions(t *testing.T) {
	ctx := context.Background()

	userID := "550e8400-e29b-41d4-a716-446655440003"
	messageID := "550e8400-e29b-41d4-a716-446655440003"
	chatID := "550e8400-e29b-41d4-a716-446655440001"
	emoji := "👍"

	db, mock, service, ws := setupTest(t)
	defer db.Close()

	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("👍", 1, true))

	mock.ExpectCommit()

	status1, currentEmoji1, reactions1, err1 := service.ToggleReaction(ctx, userID, messageID, emoji)
	require.NoError(t, err1)
	assert.Equal(t, StatusAdded, status1)
	assert.Equal(t, emoji, currentEmoji1)
	assert.Len(t, reactions1, 1)
	assert.True(t, reactions1[0].MyReaction)
	assert.Equal(t, 1, ws.BroadcastToChatCount)

	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(emoji))

	mock.ExpectExec(regexp.QuoteMeta(
		`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}))

	mock.ExpectCommit()

	status2, currentEmoji2, reactions2, err2 := service.ToggleReaction(ctx, userID, messageID, emoji)
	require.NoError(t, err2)
	assert.Equal(t, StatusRemoved, status2)
	assert.Empty(t, currentEmoji2)
	assert.Empty(t, reactions2)

	assert.Equal(t, 2, ws.BroadcastToChatCount)

	assert.NoError(t, mock.ExpectationsWereMet())
}
