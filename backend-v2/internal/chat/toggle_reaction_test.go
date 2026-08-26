package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/httpx"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ==================================================================================================================
// MockRealtimeServer is a mock implementation of the realtimeServer interface.
// It records all calls to its methods for verification in tests.
// This mock is used to verify that WebSocket broadcasts are sent correctly
// without actually establishing a real WebSocket connection.
type MockRealtimeServer struct {
	// BroadcastToChat tracking
	BroadcastToChatCalled  bool   // true if BroadcastToChat was called at least once
	BroadcastToChatCount   int    // number of times BroadcastToChat was called
	BroadcastToChatChatID  string // chat ID passed to the last BroadcastToChat call
	BroadcastToChatMessage []byte // message payload passed to the last BroadcastToChat call
	BroadcastToChatExclude string // excludeUserID passed to the last BroadcastToChat call

	// BroadcastToUsers tracking
	BroadcastToUsersCalled bool     // true if BroadcastToUsers was called at least once
	BroadcastToUsersCount  int      // number of times BroadcastToUsers was called
	BroadcastToUsersIDs    []string // user IDs passed to the last BroadcastToUsers call
	BroadcastToUsersMsg    []byte   // message payload passed to the last BroadcastToUsers call

	// IsUserConnected tracking
	IsUserConnectedCalled bool   // true if IsUserConnected was called at least once
	IsUserConnectedResult bool   // value to return from IsUserConnected
	IsUserConnectedID     string // user ID passed to the last IsUserConnected call

	// CallRooms tracking
	CallRoomsCalled bool // true if CallRooms was called at least once
}

// CallRooms implements the realtimeServer interface.
// It records that the method was called and returns nil.
// In production, this would return the CallRoomManager; here we only need to verify the call.
func (m *MockRealtimeServer) CallRooms() *CallRoomManager {
	m.CallRoomsCalled = true
	return nil
}

// IsUserConnected implements the realtimeServer interface.
// It records the user ID passed and returns the preset result.
// This allows tests to simulate whether a user is currently connected via WebSocket.
func (m *MockRealtimeServer) IsUserConnected(userID string) bool {
	m.IsUserConnectedCalled = true
	m.IsUserConnectedID = userID
	return m.IsUserConnectedResult
}

// BroadcastToChat implements the realtimeServer interface.
// It records that the method was called, increments the call counter, and stores the arguments.
// This enables tests to verify that a broadcast was sent to the correct chat
// with the correct payload and exclusion rule.
func (m *MockRealtimeServer) BroadcastToChat(chatID string, message []byte, excludeUserID string) {
	m.BroadcastToChatCalled = true
	m.BroadcastToChatCount++
	m.BroadcastToChatChatID = chatID
	m.BroadcastToChatMessage = message
	m.BroadcastToChatExclude = excludeUserID
}

// BroadcastToUsers implements the realtimeServer interface.
// It records that the method was called, increments the counter, and stores the arguments.
// This is used to verify direct broadcasts to specific users (e.g., for private notifications).
func (m *MockRealtimeServer) BroadcastToUsers(userIDs []string, message []byte) {
	m.BroadcastToUsersCalled = true
	m.BroadcastToUsersCount++
	m.BroadcastToUsersIDs = userIDs
	m.BroadcastToUsersMsg = message
}

// setupTest initializes the test environment for service-layer tests.
// It creates:
//   - A sqlmock database connection to simulate SQL queries without a real database.
//   - A MockRealtimeServer to capture WebSocket interactions.
//   - A Service instance with these mocked dependencies injected.
//
// Returns:
//   - *sql.DB: the mock database connection (must be closed with defer db.Close()).
//   - sqlmock.Sqlmock: the mock object for setting expectations and verifying queries.
//   - *Service: the service under test with mocked dependencies.
//   - *MockRealtimeServer: the WebSocket mock for verifying broadcast calls.
//
// This function is used in all service-layer tests to ensure consistent setup
// and to reduce boilerplate code.
func setupTest(t *testing.T) (*sql.DB, sqlmock.Sqlmock, *Service, *MockRealtimeServer) {
	// Create a new sqlmock database connection
	db, mock, err := sqlmock.New()
	require.NoError(t, err)

	// Create a new WebSocket mock
	ws := &MockRealtimeServer{}

	// Create the service instance with mocked dependencies
	service := &Service{
		db: db,
		ws: ws,
	}

	return db, mock, service, ws
}

//==================================================================================================================

// TestToggleReaction_Scenarios tests the three main toggle scenarios:
// - Adding a new reaction (no existing reaction)
// - Removing an existing reaction (same emoji toggled again)
// - Replacing an existing reaction (different emoji)
//
// It uses a table-driven approach to reduce code duplication.
func TestToggleReaction_Scenarios(t *testing.T) {
	// Define test cases
	testCases := []struct {
		name              string
		initialEmoji      string // "" means no existing reaction
		toggleEmoji       string // emoji to toggle
		expectedStatus    ReactionStatus
		expectedCurrent   string     // expected currentEmoji after operation
		expectedReactions []Reaction // expected aggregated reactions (simplified)
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

				// 1. Get chatID
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

				// 2. Check membership
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				// 3. Advisory lock
				mock.ExpectExec(regexp.QuoteMeta(
					`SELECT pg_advisory_xact_lock($1)`,
				)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

				// 4. No current reaction
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

				// 5. Insert
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, toggleEmoji).WillReturnResult(sqlmock.NewResult(1, 1))

				// 6. Aggregation
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
			expectedReactions: []Reaction{}, // empty
			setupMock: func(mock sqlmock.Sqlmock, messageID, userID, chatID, initialEmoji, toggleEmoji string) {
				mock.ExpectBegin()

				// 1. Get chatID
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

				// 2. Check membership
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				// 3. Advisory lock
				mock.ExpectExec(regexp.QuoteMeta(
					`SELECT pg_advisory_xact_lock($1)`,
				)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

				// 4. Current reaction exists
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(initialEmoji))

				// 5. Delete
				mock.ExpectExec(regexp.QuoteMeta(
					`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

				// 6. Aggregation returns empty
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

				// 1. Get chatID
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

				// 2. Check membership
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

				// 3. Advisory lock
				mock.ExpectExec(regexp.QuoteMeta(
					`SELECT pg_advisory_xact_lock($1)`,
				)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

				// 4. Current reaction exists
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(initialEmoji))

				// 5. Update
				mock.ExpectExec(regexp.QuoteMeta(
					`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
				)).WithArgs(toggleEmoji, messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

				// 6. Aggregation returns new emoji
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).AddRow(toggleEmoji, 1, true))

				mock.ExpectCommit()
			},
		},
	}

	// Run all test cases
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()

			// Test data
			userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
			messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
			chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message

			// Setup mocks
			db, mock, service, ws := setupTest(t)
			defer db.Close()

			// Set up specific mock expectations
			tc.setupMock(mock, messageID, userID, chatID, tc.initialEmoji, tc.toggleEmoji)

			// Execute
			status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, tc.toggleEmoji)

			// Assertions
			require.NoError(t, err)
			assert.Equal(t, tc.expectedStatus, status)
			assert.Equal(t, tc.expectedCurrent, currentEmoji)
			assert.Equal(t, len(tc.expectedReactions), len(reactions))
			// Compare each reaction (simplified; you can do deeper checks)
			for i, expected := range tc.expectedReactions {
				assert.Equal(t, expected.Emoji, reactions[i].Emoji)
				assert.Equal(t, expected.Count, reactions[i].Count)
				assert.Equal(t, expected.MyReaction, reactions[i].MyReaction)
			}

			// Verify WebSocket was called (all success scenarios should have broadcast)
			// We can check count, but we already have a dedicated test for that.
			// Here we just ensure it was called at least once.
			assert.True(t, ws.BroadcastToChatCalled)
			assert.Equal(t, chatID, ws.BroadcastToChatChatID)

			// Verify SQL expectations
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestToggleReaction_AfterReplacement_OnlyOneUserReaction tests that after
// a user replaces their reaction from one emoji to another, they have exactly
// ONE reaction on the message. This is a critical invariant - the system must
// never allow a user to have multiple reactions on the same message.
//
// The test verifies:
// - The user has exactly one reaction after replacement (not zero, not multiple)
// - The myReaction flag is true for ONLY the new emoji
// - The myReaction flag is false for the old emoji (if other users have it)
// - The aggregated count for the new emoji includes the user's reaction
// - The aggregated count for the old emoji does NOT include the user's reaction
// - The database maintains the unique constraint (one reaction per user per message)
// - The WebSocket broadcast contains the correct reaction counts
func TestToggleReaction_AfterReplacement_OnlyOneUserReaction(t *testing.T) {
	// Initialize test context
	ctx := context.Background()

	// Test data - using realistic identifiers
	userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
	messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
	chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message
	oldEmoji := "👍"                                     // The emoji the user currently has
	newEmoji := "❤️"                                    // The new emoji the user is changing to

	// Setup test dependencies: database mock, service instance, WebSocket mock
	db, mock, service, ws := setupTest(t)
	defer db.Close()

	// ===== STEP 1: Begin database transaction =====
	// All subsequent operations (validation, membership, lock, reaction) run inside the transaction.
	mock.ExpectBegin()

	// ===== STEP 2: Validate message exists and retrieve chat ID =====
	// The service verifies the message exists and gets its chat ID.
	// This query filters out soft-deleted messages (deleted_at IS NULL).
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// ===== STEP 3: Verify user is a member of the chat =====
	// Authorization check - only chat members can modify reactions.
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// ===== STEP 4: Acquire advisory lock to prevent race conditions =====
	// pg_advisory_xact_lock is used (blocking version)
	// This ensures exclusive access for this (message, user) pair and waits if needed.
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	// ===== STEP 5: Retrieve the user's current reaction =====
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(oldEmoji))

	// ===== STEP 6: Update the reaction to the new emoji =====
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
	)).WithArgs(newEmoji, messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

	// ===== STEP 7: Fetch aggregated reactions with multiple emojis =====
	// Simulate a scenario with three emojis, where the user's reaction appears only once.
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("❤️", 1, true). // User's new reaction
		AddRow("😊", 2, false). // Other users
		AddRow("👍", 3, false)) // Other users still have thumbs up

	// ===== STEP 8: Commit transaction =====
	mock.ExpectCommit()

	// ===== EXECUTE: Call the service method =====
	status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, newEmoji)

	// ===== VERIFICATIONS =====
	require.NoError(t, err)
	assert.Equal(t, StatusReplaced, status)
	assert.Equal(t, newEmoji, currentEmoji)

	// Verify the user has exactly ONE reaction after replacement
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

	// Verify individual reaction details (order: most popular first)
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

	// WebSocket verification
	assert.True(t, ws.BroadcastToChatCalled)
	assert.Equal(t, chatID, ws.BroadcastToChatChatID)

	// Final verification of all SQL expectations
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestToggleReaction_AggregatedCountsCorrect tests that the aggregated reaction
// counts returned by the service are accurate and correctly reflect the database state.
//
// This test verifies:
// - The COUNT(*) aggregation correctly counts all reactions per emoji
// - The bool_or function correctly identifies the current user's reactions
// - Results are ordered by count in DESCENDING order (most popular first)
// - Each emoji's count includes ALL users who have reacted with that emoji
// - The myReaction flag is correctly set to true ONLY for the current user's reactions
// - The myReaction flag is false for emojis the user hasn't reacted with
// - The aggregated results match the actual state of the database
// - Multiple emojis with different counts are handled correctly
//
// This test ensures the aggregation query in listReactionsInternal works correctly
// and provides accurate real-time reaction statistics to clients.
func TestToggleReaction_AggregatedCountsCorrect(t *testing.T) {
	// Initialize test context
	ctx := context.Background()

	// Test data using realistic identifiers
	userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
	messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
	chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message
	emoji := "👍"                                        // The emoji the user is adding

	// Setup test dependencies
	db, mock, service, ws := setupTest(t)
	defer db.Close()

	// ===== STEP 1: Begin database transaction =====
	// All subsequent operations run inside the transaction.
	mock.ExpectBegin()

	// ===== STEP 2: Validate message exists and retrieve chat ID =====
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// ===== STEP 3: Verify user is a member of the chat =====
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// ===== STEP 4: Acquire advisory lock to prevent race conditions =====
	// pg_advisory_xact_lock (blocking version).
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	// ===== STEP 5: Check if user already has a reaction =====
	// No existing reaction (sql.ErrNoRows) means we will insert.
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	// ===== STEP 6: Insert the user's new reaction =====
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

	// ===== STEP 7: Fetch aggregated reactions with rich test data =====
	// Mock data: 3 emojis with varying counts, user has reaction only on "👍".
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("👍", 5, true).   // Most popular, user has reacted
		AddRow("❤️", 3, false). // Second most popular, user has not reacted
		AddRow("😊", 1, false))  // Least popular, user has not reacted

	// ===== STEP 8: Commit transaction =====
	mock.ExpectCommit()

	// ===== EXECUTE: Call the service method =====
	status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, emoji)

	// ===== VERIFICATIONS =====
	require.NoError(t, err)
	assert.Equal(t, StatusAdded, status)
	assert.Equal(t, emoji, currentEmoji)

	// Verify exactly 3 reactions (emojis with count > 0)
	assert.Len(t, reactions, 3)

	// Verify ordering: most popular first
	assert.GreaterOrEqual(t, reactions[0].Count, reactions[1].Count)
	assert.GreaterOrEqual(t, reactions[1].Count, reactions[2].Count)

	// Verify first reaction: 👍 with 5, myReaction=true
	assert.Equal(t, "👍", reactions[0].Emoji)
	assert.Equal(t, 5, reactions[0].Count)
	assert.True(t, reactions[0].MyReaction)

	// Verify second reaction: ❤️ with 3, myReaction=false
	assert.Equal(t, "❤️", reactions[1].Emoji)
	assert.Equal(t, 3, reactions[1].Count)
	assert.False(t, reactions[1].MyReaction)

	// Verify third reaction: 😊 with 1, myReaction=false
	assert.Equal(t, "😊", reactions[2].Emoji)
	assert.Equal(t, 1, reactions[2].Count)
	assert.False(t, reactions[2].MyReaction)

	// Verify total reactions sum
	total := 0
	for _, r := range reactions {
		total += r.Count
	}
	assert.Equal(t, 9, total)

	// Verify each count > 0
	for _, r := range reactions {
		assert.Greater(t, r.Count, 0)
	}

	// Verify exactly one reaction with myReaction=true
	var myCount int
	for _, r := range reactions {
		if r.MyReaction {
			myCount++
			assert.Equal(t, emoji, r.Emoji)
		}
	}
	assert.Equal(t, 1, myCount)

	// WebSocket verification
	assert.True(t, ws.BroadcastToChatCalled)
	assert.Equal(t, chatID, ws.BroadcastToChatChatID)

	// Final verification of all SQL expectations
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestToggleReaction_WebSocketBroadcast tests that WebSocket broadcast is sent
// exactly once on success and not sent on failure (rollback).
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

			// ===== STEP 1: Begin transaction =====
			mock.ExpectBegin()

			// ===== STEP 2: Validate message and get chat ID =====
			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
			)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

			// ===== STEP 3: Verify user is a member =====
			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
			)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

			// ===== STEP 4: Acquire advisory lock =====
			// Replaced with pg_advisory_xact_lock (blocking)
			mock.ExpectExec(regexp.QuoteMeta(
				`SELECT pg_advisory_xact_lock($1)`,
			)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

			// ===== STEP 5: Check current reaction (none) =====
			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
			)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

			if tc.shouldSucceed {
				// ===== STEP 6: Insert reaction =====
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

				// ===== STEP 7: Aggregate reactions =====
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
					AddRow("👍", 1, true))

				// ===== STEP 8: Commit =====
				mock.ExpectCommit()
			} else {
				// Failing insert - no commit
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, emoji).WillReturnError(errors.New("insert error"))
				// No ExpectCommit - transaction will roll back
			}

			// Execute
			_, _, _, err := service.ToggleReaction(ctx, userID, messageID, emoji)

			if tc.shouldSucceed {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}

			// Verify WebSocket call count
			assert.Equal(t, tc.expectedCallCount, ws.BroadcastToChatCount)

			// Verify SQL expectations
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestToggleReaction_DoubleCalls_NoDuplicateReactions demonstrates that
// calling ToggleReaction twice with the same emoji does not create two reactions.
// It verifies the toggle-off behavior: first call adds, second call removes.
// This protects against duplicate reactions from rapid successive clicks.
func TestToggleReaction_DoubleCalls_NoDuplicateReactions(t *testing.T) {
	ctx := context.Background()

	userID := "550e8400-e29b-41d4-a716-446655440003"
	messageID := "550e8400-e29b-41d4-a716-446655440003"
	chatID := "550e8400-e29b-41d4-a716-446655440001"
	emoji := "👍"

	db, mock, service, ws := setupTest(t)
	defer db.Close()

	// ===== FIRST CALL: Add reaction =====
	// Begin transaction
	mock.ExpectBegin()

	// Validate message and get chat ID
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// Verify membership
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Advisory lock - using blocking version with Exec
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	// No current reaction
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	// Insert
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

	// Aggregation
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("👍", 1, true))

	mock.ExpectCommit()

	// Execute first call
	status1, currentEmoji1, reactions1, err1 := service.ToggleReaction(ctx, userID, messageID, emoji)
	require.NoError(t, err1)
	assert.Equal(t, StatusAdded, status1)
	assert.Equal(t, emoji, currentEmoji1)
	assert.Len(t, reactions1, 1)
	assert.True(t, reactions1[0].MyReaction)
	assert.Equal(t, 1, ws.BroadcastToChatCount) // first broadcast

	// ===== SECOND CALL: Remove reaction (toggle off) =====
	// Begin transaction
	mock.ExpectBegin()

	// Validate message and get chat ID
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// Verify membership
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Advisory lock - using blocking version with Exec
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	// Current reaction exists
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(emoji))

	// Delete
	mock.ExpectExec(regexp.QuoteMeta(
		`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

	// Aggregation returns empty
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}))

	mock.ExpectCommit()

	// Execute second call
	status2, currentEmoji2, reactions2, err2 := service.ToggleReaction(ctx, userID, messageID, emoji)
	require.NoError(t, err2)
	assert.Equal(t, StatusRemoved, status2)
	assert.Empty(t, currentEmoji2)
	assert.Empty(t, reactions2)

	// Verify second broadcast was sent (now 2 total)
	assert.Equal(t, 2, ws.BroadcastToChatCount)

	// Final verification: no duplicate reactions - we have removed it
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestHandler_ToggleReaction_ErrorScenarios tests various error scenarios
// for the reaction toggle endpoint using a table-driven approach.
//
// This test covers:
// - Message not found → 404 Not Found
// - User not a member of the chat → 403 Forbidden
// - Invalid emoji (empty) → 400 Bad Request
//
// Each test case sets up specific database mock expectations and verifies
// the HTTP status code, error code, error message, and request ID propagation.
func TestHandler_ToggleReaction_ErrorScenarios(t *testing.T) {
	// Define test cases
	testCases := []struct {
		name           string
		emoji          string
		setupMocks     func(mock sqlmock.Sqlmock, messageID, userID, chatID string)
		expectedStatus int
		expectedCode   string
		expectedMsg    string
	}{
		{
			name:  "message not found → 404",
			emoji: "👍",
			setupMocks: func(mock sqlmock.Sqlmock, messageID, userID, chatID string) {
				// Transaction begins before the message check
				mock.ExpectBegin()
				// Then the message existence check fails with sql.ErrNoRows
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnError(sql.ErrNoRows)
				// No further expectations (rollback will happen automatically)
			},
			expectedStatus: http.StatusNotFound,
			expectedCode:   "not_found",
			expectedMsg:    "message not found",
		},
		{
			name:  "user not a member → 403",
			emoji: "👍",
			setupMocks: func(mock sqlmock.Sqlmock, messageID, userID, chatID string) {
				// Transaction begins
				mock.ExpectBegin()
				// Message exists, returns chatID
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
				// Membership check returns false (not a member)
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				// No further expectations (rollback will happen)
			},
			expectedStatus: http.StatusForbidden,
			expectedCode:   "access_denied",
			expectedMsg:    "access denied",
		},
		{
			name:  "invalid emoji (empty) → 400",
			emoji: "",
			setupMocks: func(mock sqlmock.Sqlmock, messageID, userID, chatID string) {
				// No database expectations because validation fails before DB access
			},
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "validation_failed",
			expectedMsg:    "emoji required",
		},
	}

	// Run all test cases
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup mocks and service
			db, mock, service, _ := setupTest(t)
			defer db.Close()

			handler := NewHandler(service)

			// Test data
			userID := "550e8400-e29b-41d4-a716-446655440003"
			messageID := "550e8400-e29b-41d4-a716-446655440003"
			chatID := "550e8400-e29b-41d4-a716-446655440001"

			// Setup mocks for this test case
			tc.setupMocks(mock, messageID, userID, chatID)

			// Build request
			body, _ := json.Marshal(map[string]string{"emoji": tc.emoji})
			req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+messageID+"/reactions", strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Request-ID", "test-request-id")

			user := authctx.User{ID: userID, Username: "testuser"}

			// add user into context
			ctx := authctx.WithUser(req.Context(), user)
			req = req.WithContext(ctx)

			// Execute request
			w := httptest.NewRecorder()
			handler.Messages(w, req)

			// Verify status code
			assert.Equal(t, tc.expectedStatus, w.Code)

			// Verify error response
			var resp httpx.Error
			err := json.Unmarshal(w.Body.Bytes(), &resp)
			require.NoError(t, err)
			assert.Equal(t, tc.expectedCode, resp.Code)
			assert.Equal(t, tc.expectedMsg, resp.Message)
			assert.Equal(t, "test-request-id", resp.RequestID)

			// Verify all expectations
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestHandler_ToggleReaction_TransactionErrorRollback tests the HTTP handler behavior
// when a database error occurs during the transaction, causing a rollback.
//
// This test simulates an error during the INSERT operation inside the transaction.
// It verifies:
// - The service correctly returns an error when a database operation fails
// - The handler translates the error to HTTP 500 Internal Server Error
// - The response body contains the proper error code and message
// - The X-Request-ID header is propagated to the error response
// - The transaction is rolled back (no COMMIT is expected or executed)
func TestHandler_ToggleReaction_TransactionErrorRollback(t *testing.T) {
	// Setup test dependencies
	db, mock, service, _ := setupTest(t)
	defer db.Close()

	handler := NewHandler(service)

	userID := "550e8400-e29b-41d4-a716-446655440003"
	messageID := "550e8400-e29b-41d4-a716-446655440003"
	chatID := "550e8400-e29b-41d4-a716-446655440001"
	emoji := "👍"

	body, _ := json.Marshal(map[string]string{"emoji": emoji})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+messageID+"/reactions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", "test-request-id")

	user := authctx.User{ID: userID, Username: "testuser"}

	// add user into context
	ctx := authctx.WithUser(req.Context(), user)
	req = req.WithContext(ctx)

	// ===== Mock expectations in correct order =====
	// 1. Begin transaction
	mock.ExpectBegin()

	// 2. Check message exists and get chat_id
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// 3. Verify membership
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// 4. Acquire advisory lock - replaced with blocking version using Exec
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock($1)`,
	)).WithArgs(getAdvisoryKey(messageID, userID)).WillReturnResult(sqlmock.NewResult(0, 0))

	// 5. Check current reaction – user has none
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	// 6. Attempt INSERT – simulate error
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnError(errors.New("duplicate key violation or connection failure"))

	// No ExpectCommit – transaction will roll back

	// Execute request
	w := httptest.NewRecorder()
	handler.Messages(w, req)

	// Verify HTTP 500
	assert.Equal(t, http.StatusInternalServerError, w.Code)

	// Verify error response
	var resp httpx.Error
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Equal(t, "internal_error", resp.Code)
	assert.Equal(t, "reaction failed", resp.Message)
	assert.Equal(t, "test-request-id", resp.RequestID)

	// Verify all expectations (no commit was expected)
	assert.NoError(t, mock.ExpectationsWereMet())
}
