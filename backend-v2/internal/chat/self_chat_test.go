package chat

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const selfChatUserID = "71900000-0000-4000-8000-000000000001"

func TestCreatePrivateCreatesSelfChat(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO chats\.chats .*VALUES \('self', \$2, \$1\).*ON CONFLICT \(owner_id\) WHERE type = 'self' DO NOTHING`).
		WithArgs(selfChatUserID, savedMessagesTitle).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("71900000-0000-4000-8000-000000000002"))
	mock.ExpectExec(`INSERT INTO chats\.members`).
		WithArgs("71900000-0000-4000-8000-000000000002", selfChatUserID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	chatID, exists, err := NewService(db, nil, nil).CreatePrivate(t.Context(), selfChatUserID, selfChatUserID)
	require.NoError(t, err)
	require.Equal(t, "71900000-0000-4000-8000-000000000002", chatID)
	require.False(t, exists)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreatePrivateReturnsAndRepairsExistingSelfChat(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	const chatID = "71900000-0000-4000-8000-000000000003"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO chats\.chats`).
		WithArgs(selfChatUserID, savedMessagesTitle).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT id::text.*FROM chats\.chats.*WHERE owner_id = \$1 AND type = 'self'`).
		WithArgs(selfChatUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(chatID))
	mock.ExpectExec(`INSERT INTO chats\.members`).
		WithArgs(chatID, selfChatUserID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	got, exists, err := NewService(db, nil, nil).CreatePrivate(t.Context(), selfChatUserID, selfChatUserID)
	require.NoError(t, err)
	require.Equal(t, chatID, got)
	require.True(t, exists)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateCallRoomRejectsSelfChat(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	const chatID = "71900000-0000-4000-8000-000000000004"
	mock.ExpectQuery(`SELECT c\.type.*FROM chats\.chats c.*JOIN chats\.members`).
		WithArgs(chatID, selfChatUserID).
		WillReturnRows(sqlmock.NewRows([]string{"type", "blocked_by_peer"}).AddRow("self", false))

	_, err = NewService(db, nil, nil).CreateCallRoom(
		t.Context(), selfChatUserID, chatID, "p2p", "video", savedMessagesTitle,
	)
	require.ErrorIs(t, err, ErrInvalidChatType)
	require.NoError(t, mock.ExpectationsWereMet())
}
