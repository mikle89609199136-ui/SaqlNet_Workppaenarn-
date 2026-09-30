package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	// memberMuteQuery — проверка права писать в SendMessage: mute для
	// участников любой роли (включая admin) и блокировка собеседником по
	// личному чату (#760).
	memberMuteQuery = `(?s)SELECT cm\.role,.*JOIN users\.blocked_users b.*WHERE cm\.chat_id = \$1 AND cm\.user_id = \$2`
	muteTestChatID  = "550e8400-e29b-41d4-a716-446655440002"
	muteTestUserID  = "550e8400-e29b-41d4-a716-446655440003"
)

// expectMutedMembership мокирует выборку membership с активным mute
// для участника с заданной ролью.
func expectMutedMembership(mock sqlmock.Sqlmock, role string) {
	mock.ExpectQuery(memberMuteQuery).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted", "blocked_by_peer", "chat_type"}).AddRow(role, true, false, "private"))
}

// TestSendMessage_MutedMember проверяет, что замьюченный member не может
// отправить сообщение: возвращается ErrMemberMuted, INSERT не выполняется.
func TestSendMessage_MutedMember(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil, nil)

	expectMutedMembership(mock, "member")

	_, err = svc.SendMessages(context.Background(), muteTestUserID, muteTestChatID, []chat.OutgoingMessage{{Content: "hello", Type: "text"}})
	require.ErrorIs(t, err, chat.ErrMemberMuted)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestSendMessage_MutedAdmin проверяет, что mute действует и на admin:
// возвращается ErrMemberMuted. Закрывает баг старой проверки
// `cm.role = 'member' AND cm.muted_until > NOW()`, при которой
// замьюченный admin мог писать в чат.
func TestSendMessage_MutedAdmin(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil, nil)

	expectMutedMembership(mock, "admin")

	_, err = svc.SendMessages(context.Background(), muteTestUserID, muteTestChatID, []chat.OutgoingMessage{{Content: "hello", Type: "text"}})
	require.ErrorIs(t, err, chat.ErrMemberMuted)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestSendMessage_BlockedByPeer: собеседник по личному чату заблокировал
// отправителя — сообщение не сохраняется и не рассылается (#760).
func TestSendMessage_BlockedByPeer(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = db.Close() }()
	mock.ExpectQuery(memberMuteQuery).
		WithArgs(muteTestChatID, muteTestUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role", "is_muted", "blocked_by_peer", "chat_type"}).AddRow("member", false, true, "private"))

	_, err = chat.NewService(db, nil, nil).SendMessages(context.Background(), muteTestUserID, muteTestChatID, []chat.OutgoingMessage{{Content: "hello", Type: "text"}})

	require.ErrorIs(t, err, chat.ErrBlockedByUser)
	// Ни INSERT, ни других запросов.
	require.NoError(t, mock.ExpectationsWereMet())
}
