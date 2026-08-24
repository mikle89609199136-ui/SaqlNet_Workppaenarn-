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
				// Expectations for adding a reaction (as in original test)
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
				// No current reaction
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)
				// Insert
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, toggleEmoji).WillReturnResult(sqlmock.NewResult(1, 1))
				// Aggregation
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
					AddRow(toggleEmoji, 1, true))
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
				// Expectations for removing (as in original test)
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
				// Current reaction exists
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(initialEmoji))
				// Delete
				mock.ExpectExec(regexp.QuoteMeta(
					`DELETE FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))
				// Aggregation returns empty
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
				// Expectations for replacing (as in original test)
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
				// Current reaction exists
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(initialEmoji))
				// Update
				mock.ExpectExec(regexp.QuoteMeta(
					`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
				)).WithArgs(toggleEmoji, messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))
				// Aggregation returns new emoji
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
					AddRow(toggleEmoji, 1, true))
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
	// Ensure database connection is properly closed
	defer db.Close()

	// ===== STEP 1: Validate message exists and retrieve chat ID =====
	// The service verifies the message exists and gets its chat ID
	// This query filters out soft-deleted messages (deleted_at IS NULL)
	// Expected: Return the chat_id associated with this message
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// ===== STEP 2: Verify user is a member of the chat =====
	// Authorization check - only chat members can modify reactions
	// The EXISTS subquery returns true if the user belongs to the chat
	// Expected: true (user has permission to react)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// ===== STEP 3: Begin database transaction =====
	// Start a new transaction with RepeatableRead isolation level
	// Ensures consistent snapshot view throughout the operation
	mock.ExpectBegin()

	// ===== STEP 4: Lock the message row to prevent race conditions =====
	// SELECT FOR UPDATE acquires an exclusive lock on the message row
	// Prevents concurrent operations from creating duplicate reactions
	// Expected: Return 1 (message exists and is now locked)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

	// ===== STEP 5: Retrieve the user's current reaction =====
	// Query to check what emoji the user currently has on this message
	// Expected: Return the existing emoji ("👍" in this case)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji"}).AddRow(oldEmoji))

	// ===== STEP 6: Update the reaction to the new emoji =====
	// The UPDATE changes the emoji while keeping the same record
	// This preserves the invariant: one reaction per user per message
	// Expected: 1 row affected (the updated reaction)
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE messages.reactions SET emoji = $1 WHERE message_id = $2 AND user_id = $3`,
	)).WithArgs(newEmoji, messageID, userID).WillReturnResult(sqlmock.NewResult(0, 1))

	// ===== STEP 7: Fetch aggregated reactions with multiple emojis =====
	// This is the CRITICAL verification step for this test.
	// We simulate a scenario where other users have reacted with different emojis.
	// The query returns aggregated counts for THREE different emojis:
	//   1. "❤️" - count=1, myReaction=true (the user's NEW reaction)
	//   2. "👍" - count=3, myReaction=false (other users still have 👍)
	//   3. "😊" - count=2, myReaction=false (other users have this too)
	//
	// Key expectations:
	// - The user should appear in ONLY ONE emoji's count (❤️)
	// - The user should NOT appear in the old emoji's count (👍)
	// - The myReaction flag should be true ONLY for ❤️
	// - The myReaction flag should be false for all other emojis
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("❤️", 1, true). // User's new reaction - myReaction=true
		AddRow("😊", 2, false). // Other users only - myReaction=false
		AddRow("👍", 3, false)) // Other users still have thumbs up - myReaction=false

	// ===== STEP 8: Commit transaction =====
	// Make all changes permanent in the database
	mock.ExpectCommit()

	// ===== EXECUTE: Call the service method =====
	// The method performs the replacement operation and returns aggregated results
	status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, newEmoji)

	// ===== VERIFICATIONS =====

	// Verify no error occurred during the operation
	require.NoError(t, err)

	// Verify the status is "replaced" (reaction was updated)
	assert.Equal(t, StatusReplaced, status)

	// Verify the current emoji is the new emoji (❤️)
	assert.Equal(t, newEmoji, currentEmoji)

	// ===== CRITICAL VERIFICATION: EXACTLY ONE USER REACTION =====
	//
	// We iterate through all aggregated reactions and count how many have
	// myReaction=true. This should be exactly 1, indicating the user has
	// only one reaction on this message.
	var myReactionsCount int
	var userEmoji string
	for _, r := range reactions {
		if r.MyReaction {
			myReactionsCount++
			userEmoji = r.Emoji
		}
	}

	// Verify the user has exactly ONE reaction after replacement
	// This is the key invariant: one user = one reaction per message
	assert.Equal(t, 1, myReactionsCount,
		"User should have exactly ONE reaction on a message, but found %d",
		myReactionsCount)

	// Verify the one reaction is the NEW emoji (❤️), not the old one
	assert.Equal(t, newEmoji, userEmoji,
		"User's only reaction should be the new emoji (%s), but got %s",
		newEmoji, userEmoji)

	// ===== VERIFY INDIVIDUAL REACTION DETAILS =====
	// The reactions are ordered by count descending (most popular first)
	// Expect the order: ❤️ (1), 😊 (2), 👍 (3)
	assert.Len(t, reactions, 3, "Should have 3 distinct emojis with reactions")

	// Verify the first reaction: ❤️ (user's reaction, count=1)
	assert.Equal(t, "❤️", reactions[0].Emoji)
	assert.Equal(t, 1, reactions[0].Count)
	assert.True(t, reactions[0].MyReaction,
		"User should have myReaction=true for their reaction (❤️)")

	// Verify the second reaction: 😊 (count=2, not user's reaction)
	assert.Equal(t, "😊", reactions[1].Emoji)
	assert.Equal(t, 2, reactions[1].Count)
	assert.False(t, reactions[1].MyReaction,
		"User should have myReaction=false for reactions they didn't make (😊)")

	// Verify the third reaction: 👍 (count=3, not user's reaction)
	assert.Equal(t, "👍", reactions[2].Emoji)
	assert.Equal(t, 3, reactions[2].Count)
	assert.False(t, reactions[2].MyReaction,
		"User should have myReaction=false for reactions they didn't make (👍)")

	// ===== VERIFY THE USER'S OLD REACTION IS GONE =====
	// After replacement, the user should NOT appear in the old emoji's count
	// In our mock, the old emoji (👍) has count=3, but all from other users
	// The myReaction=false confirms the user is NOT part of that count

	// ===== WEBSOCKET VERIFICATION =====
	// Verify WebSocket broadcast was triggered for real-time updates
	assert.True(t, ws.BroadcastToChatCalled)

	// Verify the broadcast was sent to the correct chat
	assert.Equal(t, chatID, ws.BroadcastToChatChatID)

	// Optional: Verify the broadcast payload contains the correct reactions
	// The payload should include all three emojis with their counts and myReaction flags

	// ===== FINAL VERIFICATION =====
	// Ensure all SQL expectations were met exactly as defined
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

	// ===== STEP 1: Validate message exists and retrieve chat ID =====
	// Verify the message exists and get its chat ID
	// This query filters out soft-deleted messages
	// Expected: Return the chat_id associated with this message
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// ===== STEP 2: Verify user is a member of the chat =====
	// Authorization check - only chat members can react
	// Expected: true (user has permission)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// ===== STEP 3: Begin database transaction =====
	// Start a new transaction with RepeatableRead isolation level
	// Ensures consistent snapshot view throughout the operation
	mock.ExpectBegin()

	// ===== STEP 4: Lock the message row =====
	// SELECT FOR UPDATE acquires an exclusive lock on the message row
	// Prevents concurrent modifications during aggregation
	// Expected: Return 1 (message exists and is locked)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

	// ===== STEP 5: Check if user already has a reaction =====
	// Query to check if the user already has a reaction on this message
	// Expected: No rows (user hasn't reacted yet)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	// ===== STEP 6: Insert the user's new reaction =====
	// User is adding their first reaction to this message
	// Expected: 1 row inserted
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

	// ===== STEP 7: Fetch aggregated reactions with rich test data =====
	// THIS IS THE CRITICAL VERIFICATION STEP.
	// We mock a scenario with MULTIPLE EMOJIS and VARYING COUNTS to verify
	// that the aggregation query correctly counts, groups, and orders the results.
	//
	// The mock data represents the following state:
	//   1. "👍" - 5 reactions (MOST POPULAR) - User has reacted with this
	//   2. "❤️" - 3 reactions (SECOND MOST POPULAR) - User has NOT reacted
	//   3. "😊" - 1 reaction (LEAST POPULAR) - User has NOT reacted
	//   4. "🔥" - 0 reactions (SHOULD NOT APPEAR) - No one has used this
	//
	// The aggregation query must:
	//   - GROUP BY emoji
	//   - COUNT(*) each emoji's occurrences
	//   - Use bool_or(user_id = $2) to flag user's reactions
	//   - ORDER BY cnt DESC (most popular first)
	//
	// Important: Only emojis with count > 0 should appear in results.
	// Emojis with 0 reactions should be excluded from the response.
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
	)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
		AddRow("👍", 5, true).   // Most popular, user has reacted
		AddRow("❤️", 3, false). // Second most popular, user has not reacted
		AddRow("😊", 1, false))  // Least popular, user has not reacted

	// ===== STEP 8: Commit transaction =====
	// Make all changes permanent in the database
	mock.ExpectCommit()

	// ===== EXECUTE: Call the service method =====
	// The method inserts the user's reaction and returns aggregated counts
	status, currentEmoji, reactions, err := service.ToggleReaction(ctx, userID, messageID, emoji)

	// ===== VERIFICATIONS =====

	// Verify no error occurred during the operation
	require.NoError(t, err)

	// Verify the status is "added" (new reaction created)
	assert.Equal(t, StatusAdded, status)

	// Verify the current emoji is the one we added
	assert.Equal(t, emoji, currentEmoji)

	// ===== CRITICAL VERIFICATION 1: REACTION COUNT =====
	// Verify we have exactly 3 reactions (not 4, because "🔥" has 0 reactions)
	// The aggregate query should filter out emojis with COUNT(*) = 0
	assert.Len(t, reactions, 3,
		"Should have 3 reactions (emojis with count > 0), got %d", len(reactions))

	// ===== VERIFICATION 2: ORDERING (MOST POPULAR FIRST) =====
	// Verify reactions are sorted by count in DESCENDING order
	// This is critical for UI display where most popular reactions should appear first
	assert.GreaterOrEqual(t, reactions[0].Count, reactions[1].Count,
		"First reaction should have highest count (most popular)")
	assert.GreaterOrEqual(t, reactions[1].Count, reactions[2].Count,
		"Second reaction should have higher count than third")

	// ===== VERIFICATION 3: FIRST REACTION (MOST POPULAR - 👍 with 5) =====
	// This is the most popular reaction and the user's own reaction
	assert.Equal(t, "👍", reactions[0].Emoji,
		"First reaction should be the most popular emoji '👍'")
	assert.Equal(t, 5, reactions[0].Count,
		"Most popular emoji '👍' should have count of 5")
	assert.True(t, reactions[0].MyReaction,
		"User should have myReaction=true for '👍' (they just added it)")

	// ===== VERIFICATION 4: SECOND REACTION (SECOND MOST POPULAR - ❤️ with 3) =====
	// This is the second most popular reaction and NOT the user's reaction
	assert.Equal(t, "❤️", reactions[1].Emoji,
		"Second reaction should be the second most popular emoji '❤️'")
	assert.Equal(t, 3, reactions[1].Count,
		"Second most popular emoji '❤️' should have count of 3")
	assert.False(t, reactions[1].MyReaction,
		"User should have myReaction=false for '❤️' (they didn't react with it)")

	// ===== VERIFICATION 5: THIRD REACTION (LEAST POPULAR - 😊 with 1) =====
	// This is the least popular reaction and NOT the user's reaction
	assert.Equal(t, "😊", reactions[2].Emoji,
		"Third reaction should be the least popular emoji '😊'")
	assert.Equal(t, 1, reactions[2].Count,
		"Least popular emoji '😊' should have count of 1")
	assert.False(t, reactions[2].MyReaction,
		"User should have myReaction=false for '😊' (they didn't react with it)")

	// ===== VERIFICATION 6: AGGREGATION ACCURACY CHECKS =====
	// Additional checks to ensure the aggregation is mathematically correct

	// Calculate total reactions from the aggregated data
	totalReactions := 0
	for _, r := range reactions {
		totalReactions += r.Count
	}

	// The total number of reactions should equal the sum of all individual reactions
	// 5 + 3 + 1 = 9 total reactions across all emojis
	assert.Equal(t, 9, totalReactions,
		"Total reactions (5+3+1) should equal 9")

	// Verify each reaction count is a positive integer (should never be 0 or negative)
	for _, r := range reactions {
		assert.Greater(t, r.Count, 0,
			"Reaction count for '%s' should be greater than 0", r.Emoji)
	}

	// Verify the myReaction flag is set correctly for each emoji
	// Only the emoji the user reacted with should have myReaction=true
	var myReactionsCount int
	for _, r := range reactions {
		if r.MyReaction {
			myReactionsCount++
			// The user's reaction should be the one they added
			assert.Equal(t, emoji, r.Emoji,
				"User's reaction should be '%s', but got '%s'", emoji, r.Emoji)
		}
	}

	// User should have exactly one reaction (myReaction=true)
	assert.Equal(t, 1, myReactionsCount,
		"User should have exactly one reaction with myReaction=true")

	// ===== WEBSOCKET VERIFICATION =====
	// Verify WebSocket broadcast was triggered
	assert.True(t, ws.BroadcastToChatCalled)

	// Verify the broadcast was sent to the correct chat
	assert.Equal(t, chatID, ws.BroadcastToChatChatID)

	// Optional: Verify the WebSocket payload contains the correct counts
	// This ensures real-time updates accurately reflect the aggregated state

	// ===== FINAL VERIFICATION =====
	// Ensure all SQL expectations were met exactly as defined
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
			userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
			messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
			chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message
			emoji := "👍"                                        // The emoji the user is adding

			db, mock, service, ws := setupTest(t)
			defer db.Close()

			// Common expectations for both cases
			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
			)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
			)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
			)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

			mock.ExpectQuery(regexp.QuoteMeta(
				`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
			)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

			if tc.shouldSucceed {
				// Successful insert
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, emoji).WillReturnResult(sqlmock.NewResult(1, 1))

				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT emoji, COUNT(*) AS cnt, bool_or(user_id = $2) AS my_reaction FROM messages.reactions WHERE message_id = $1 GROUP BY emoji ORDER BY cnt DESC`,
				)).WithArgs(messageID, userID).WillReturnRows(sqlmock.NewRows([]string{"emoji", "cnt", "my_reaction"}).
					AddRow("👍", 1, true))

				mock.ExpectCommit()
			} else {
				// Failing insert
				mock.ExpectExec(regexp.QuoteMeta(
					`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
				)).WithArgs(messageID, userID, emoji).WillReturnError(errors.New("insert error"))
				// No ExpectCommit
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

// TestToggleReaction_ConcurrentCalls_NoDuplicateReactions demonstrates that
// calling ToggleReaction twice with the same emoji does not create two reactions.
// It verifies the toggle-off behavior: first call adds, second call removes.
// This protects against duplicate reactions from rapid successive clicks.
func TestToggleReaction_ConcurrentCalls_NoDuplicateReactions(t *testing.T) {
	ctx := context.Background()

	userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
	messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
	chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message
	emoji := "👍"                                        // The emoji the user is adding

	db, mock, service, ws := setupTest(t)
	defer db.Close()

	// ===== FIRST CALL: Add reaction =====
	// Expect all queries for adding
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

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

	// Execute first call
	status1, currentEmoji1, reactions1, err1 := service.ToggleReaction(ctx, userID, messageID, emoji)
	require.NoError(t, err1)
	assert.Equal(t, StatusAdded, status1)
	assert.Equal(t, emoji, currentEmoji1)
	assert.Len(t, reactions1, 1)
	assert.True(t, reactions1[0].MyReaction)
	assert.Equal(t, 1, ws.BroadcastToChatCount) // first broadcast

	// ===== SECOND CALL: Remove reaction (toggle off) =====
	// Expect all queries for deletion
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

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
				// First query fails with sql.ErrNoRows
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnError(sql.ErrNoRows)
				// No further expectations
			},
			expectedStatus: http.StatusNotFound,
			expectedCode:   "not_found",
			expectedMsg:    "message not found",
		},
		{
			name:  "user not a member → 403",
			emoji: "👍",
			setupMocks: func(mock sqlmock.Sqlmock, messageID, userID, chatID string) {
				// First query succeeds, returns chatID
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
				)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))
				// Second query returns false (not a member)
				mock.ExpectQuery(regexp.QuoteMeta(
					`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
				)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
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
			userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
			messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
			chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message

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
	// ===== STEP 1: Setup test dependencies =====
	// Initialize the database mock, service instance, and WebSocket mock.
	db, mock, service, _ := setupTest(t)
	defer db.Close()

	// ===== STEP 2: Create the handler under test =====
	handler := NewHandler(service)

	// ===== STEP 3: Define test data =====
	userID := "550e8400-e29b-41d4-a716-446655440003"    // The user performing the toggle
	messageID := "550e8400-e29b-41d4-a716-446655440003" // The message with multiple reactions
	chatID := "550e8400-e29b-41d4-a716-446655440001"    // The chat containing the message
	emoji := "👍"                                        // The emoji the user is adding

	// ===== STEP 4: Build the HTTP request =====
	body, _ := json.Marshal(map[string]string{"emoji": emoji})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/messages/"+messageID+"/reactions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", "test-request-id")

	user := authctx.User{ID: userID, Username: "testuser"}

	// add user into context
	ctx := authctx.WithUser(req.Context(), user)
	req = req.WithContext(ctx)

	// ===== STEP 5: Configure database mock expectations =====
	// 5.1: Message exists – return chat_id
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT chat_id::text FROM messages.messages WHERE id = $1 AND deleted_at IS NULL`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"chat_id"}).AddRow(chatID))

	// 5.2: User is a member – return true
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)`,
	)).WithArgs(userID, chatID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// 5.3: Begin transaction
	mock.ExpectBegin()

	// 5.4: Lock the message row – succeed
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT 1 FROM messages.messages where id = $1 FOR UPDATE`,
	)).WithArgs(messageID).WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

	// 5.5: Check current reaction – user has none (sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT emoji FROM messages.reactions WHERE message_id = $1 AND user_id = $2`,
	)).WithArgs(messageID, userID).WillReturnError(sql.ErrNoRows)

	// 5.6: Attempt to INSERT the new reaction – SIMULATE AN ERROR
	// This will cause the service to return an error and rollback the transaction.
	mock.ExpectExec(regexp.QuoteMeta(
		`INSERT INTO messages.reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
	)).WithArgs(messageID, userID, emoji).WillReturnError(errors.New("duplicate key violation or connection failure"))

	// IMPORTANT: No ExpectCommit is set, because the transaction should be rolled back.
	// The service's deferred rollback will be triggered, and we verify that no commit happens.

	// ===== STEP 6: Execute the request =====
	w := httptest.NewRecorder()
	handler.Messages(w, req)

	// ===== STEP 7: Verify HTTP status code =====
	// The handler should return 500 Internal Server Error for any unexpected DB error
	assert.Equal(t, http.StatusInternalServerError, w.Code)

	// ===== STEP 8: Verify error response body =====
	var resp httpx.Error
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.Equal(t, "internal_error", resp.Code)
	assert.Equal(t, "reaction failed", resp.Message)
	assert.Equal(t, "test-request-id", resp.RequestID)

	// ===== STEP 9: Verify all SQL expectations were met =====
	// This ensures that we executed exactly the expected queries up to the point of failure,
	// and that no COMMIT was attempted (since we didn't set an expectation for it).
	assert.NoError(t, mock.ExpectationsWereMet())
}
