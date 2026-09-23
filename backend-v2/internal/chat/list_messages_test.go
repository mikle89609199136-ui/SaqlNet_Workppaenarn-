package chat

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	listMessagesUserID = "550e8400-e29b-41d4-a716-446655440001"
	listMessagesChatID = "550e8400-e29b-41d4-a716-446655440002"
)

const (
	selectIsMemberSQL   = "SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = $1 AND chat_id = $2)"
	selectChatExistsSQL = "SELECT EXISTS(SELECT 1 FROM chats.chats WHERE id = $1)"
)

// TestListMessages_ChatNotFound проверяет, что при попытке получить сообщения
// несуществующего чата сервис возвращает ошибку ErrNotFound.
func TestListMessages_ChatNotFound(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectQuery(selectIsMemberSQL).
		WithArgs(listMessagesUserID, listMessagesChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectQuery(selectChatExistsSQL).
		WithArgs(listMessagesChatID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	svc := NewService(db, nil, nil)
	_, err = svc.ListMessages(context.Background(), listMessagesUserID, listMessagesChatID, 50, 0)
	require.ErrorIs(t, err, ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}
