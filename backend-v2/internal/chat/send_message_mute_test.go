package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestSendMessage_MutedMember(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`
		SELECT cm.role,
	       (
	         COALESCE(u.is_muted AND (u.muted_until IS NULL OR u.muted_until > NOW()), false) OR
	         (cm.muted_at IS NOT NULL AND (cm.muted_until IS NULL OR cm.muted_until > NOW()))
	       )
		FROM chats.members cm
		JOIN auth.users u ON u.id = cm.user_id
		WHERE cm.chat_id = $1 AND cm.user_id = $2
		`).
		WithArgs(chatID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("member", true))

	_, err = svc.SendMessage(context.Background(), userID, chatID, "hello", "text", nil, nil)
	require.ErrorIs(t, err, chat.ErrMemberMuted)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_MutedAdmin(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`
		SELECT cm.role,
	       (
	         COALESCE(u.is_muted AND (u.muted_until IS NULL OR u.muted_until > NOW()), false) OR
	         (cm.muted_at IS NOT NULL AND (cm.muted_until IS NULL OR cm.muted_until > NOW()))
	       )
		FROM chats.members cm
		JOIN auth.users u ON u.id = cm.user_id
		WHERE cm.chat_id = $1 AND cm.user_id = $2
		`).
		WithArgs(chatID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow("admin", true))

	_, err = svc.SendMessage(context.Background(), userID, chatID, "hello", "text", nil, nil)
	require.ErrorIs(t, err, chat.ErrMemberMuted)
	require.NoError(t, mock.ExpectationsWereMet())
}
