package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	// memberMuteQuery фиксирует целевой SQL проверки mute в SendMessage:
	// блокируются участники любой роли (включая admin) с активным
	// временным или перманентным mute (muted_at IS NOT NULL).
	memberMuteQuery = `
		SELECT cm.role,
		       (
		         COALESCE(u.is_muted AND (u.muted_until IS NULL OR u.muted_until > NOW()), false) OR
		         (cm.muted_at IS NOT NULL AND (cm.muted_until IS NULL OR cm.muted_until > NOW()))
		       )
		FROM chats.members cm
		JOIN auth.users u ON u.id = cm.user_id
		WHERE cm.chat_id = $1 AND cm.user_id = $2
		`
	muteTestChatID = "550e8400-e29b-41d4-a716-446655440002"
	muteTestUserID = "550e8400-e29b-41d4-a716-446655440003"
)

// expectMutedMembership мокирует выборку membership с активным mute
// для участника с заданной ролью.
func expectMutedMembership(mock sqlmock.Sqlmock, role string) {
	mock.ExpectQuery(memberMuteQuery).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted"}).AddRow(role, true))
}

// TestSendMessage_MutedMember проверяет, что замьюченный member не может
// отправить сообщение: возвращается ErrMemberMuted, INSERT не выполняется.
func TestSendMessage_MutedMember(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	expectMutedMembership(mock, "member")

	_, err = svc.SendMessage(context.Background(), muteTestUserID, muteTestChatID, "hello", "text", nil, nil)
	require.ErrorIs(t, err, chat.ErrMemberMuted)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestSendMessage_MutedAdmin проверяет, что mute действует и на admin:
// возвращается ErrMemberMuted. Закрывает баг старой проверки
// `cm.role = 'member' AND cm.muted_until > NOW()`, при которой
// замьюченный admin мог писать в чат.
func TestSendMessage_MutedAdmin(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	expectMutedMembership(mock, "admin")

	_, err = svc.SendMessage(context.Background(), muteTestUserID, muteTestChatID, "hello", "text", nil, nil)
	require.ErrorIs(t, err, chat.ErrMemberMuted)
	require.NoError(t, mock.ExpectationsWereMet())
}
