package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/presence"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// Тестовые UUID — валидные, чтобы не срабатывала валидация входных данных.
const (
	onlineChatID         = "550e8400-e29b-41d4-a716-456655440001"
	onlineUserID         = "550e8400-e29b-41d4-a716-456655440002"
	onlineUserID2        = "550e8400-e29b-41d4-a716-456655440003"
	onlineUserID3        = "550e8400-e29b-41d4-a716-456655440004"
	onlineconnectionID1  = "550e8400-e29b-41d4-a716-456655440005"
	onlineconnectionID12 = "550e8400-e29b-41d4-a716-456655440006"
)

const (
	selectChatTypeSQL   = "SELECT type FROM chats.chats WHERE id = $1"
	selectMemberRoleSQL = "SELECT role FROM chats.members WHERE user_id = $1 AND chat_id = $2"
	selectMemberIDsSQL  = "SELECT user_id::text FROM chats.members WHERE chat_id = $1"
)

var errRedisDown = errors.New("redis down")

// mockGroupWithMembers настраивает ожидания sqlmock для группового чата
// и выборки указанных участников для onlineChatID и onlineUserID.
func mockGroupWithMembers(mock sqlmock.Sqlmock, memberIDs ...string) {
	rows := sqlmock.NewRows([]string{"user_id"})
	for _, id := range memberIDs {
		rows.AddRow(id)
	}

	mock.ExpectQuery(selectChatTypeSQL).
		WithArgs(onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
	mock.ExpectQuery(selectMemberRoleSQL).
		WithArgs(onlineUserID, onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
	mock.ExpectQuery(selectMemberIDsSQL).
		WithArgs(onlineChatID).
		WillReturnRows(rows)
}

// TestGetOnlineMembers_InvalidChatID проверяет, что синтаксически невалидный
// chatID отклоняется с ErrInvalidInput до обращения к БД и presence-store.
func TestGetOnlineMembers_InvalidChatID(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil, nil)
	_, err = svc.GetOnlineMembers(context.Background(), "not-a-uuid", onlineUserID)
	require.ErrorIs(t, err, chat.ErrInvalidInput)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestGetOnlineMembers_ChatNotFound проверяет, что запрос online-участников
// несуществующего чата отклоняется с ErrNotFound (404), а не 403/500.
func TestGetOnlineMembers_ChatNotFound(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	mock.ExpectQuery(selectChatTypeSQL).
		WithArgs(onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}))

	svc := chat.NewService(db, nil, nil)
	_, err = svc.GetOnlineMembers(context.Background(), onlineChatID, onlineUserID)
	require.ErrorIs(t, err, chat.ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestGetOnlineMembers_NotMember проверяет, что пользователь, не состоящий
// в существующем чате, получает ErrForbidden (403): presence посторонних не раскрываем.
func TestGetOnlineMembers_NotMember(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	mock.ExpectQuery(selectChatTypeSQL).
		WithArgs(onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
	mock.ExpectQuery(selectMemberRoleSQL).
		WithArgs(onlineUserID, onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	svc := chat.NewService(db, nil, nil)
	_, err = svc.GetOnlineMembers(context.Background(), onlineChatID, onlineUserID)
	require.ErrorIs(t, err, chat.ErrForbidden)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestGetOnlineMembers_PrivateChat проверяет, что endpoint работает только для
// групповых чатов: личный чат отклоняется с ErrInvalidChatType (400).
func TestGetOnlineMembers_PrivateChat(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	mock.ExpectQuery(selectChatTypeSQL).
		WithArgs(onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("private"))
	mock.ExpectQuery(selectMemberRoleSQL).
		WithArgs(onlineUserID, onlineChatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))

	svc := chat.NewService(db, nil, nil)
	_, err = svc.GetOnlineMembers(context.Background(), onlineChatID, onlineUserID)
	require.ErrorIs(t, err, chat.ErrInvalidChatType)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestGetOnlineMembers_ReturnsOnlyOnlineMembers проверяет happy path: из всех
// участников группы возвращаются только UUID с живой presence-lease, в порядке выборки из БД.
func TestGetOnlineMembers_ReturnsOnlyOnlineMembers(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	store := presence.NewMemoryStore(time.Now)
	if err := store.Connect(context.Background(), onlineUserID, onlineconnectionID1); err != nil {
		t.Fatal(err)
	}
	if err := store.Connect(context.Background(), onlineUserID2, onlineconnectionID12); err != nil {
		t.Fatal(err)
	}

	svc := chat.NewService(db, nil, store)

	mockGroupWithMembers(mock, onlineUserID, onlineUserID2, onlineUserID3)

	got, err := svc.GetOnlineMembers(context.Background(), onlineChatID, onlineUserID)
	require.NoError(t, err)
	require.Equal(t, []string{onlineUserID, onlineUserID2}, got)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestGetOnlineMembers_NoOneOnline фиксирует контракт: при отсутствии online-участников
// возвращается пустой не-nil срез, чтобы JSON-ответ был [], а не null.
func TestGetOnlineMembers_NoOneOnline(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	store := presence.NewMemoryStore(time.Now)
	svc := chat.NewService(db, nil, store)

	mockGroupWithMembers(mock, onlineUserID, onlineUserID2, onlineUserID3)

	got, err := svc.GetOnlineMembers(context.Background(), onlineChatID, onlineUserID)
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Empty(t, got)
	require.NoError(t, mock.ExpectationsWereMet())
}

// errPresenceStore — заглушка Store, всегда возвращающая ошибку:
// проверяем, что сбой presence не маскируется в пустой список.
type errPresenceStore struct {
	err error
}

func (s errPresenceStore) Connect(context.Context, string, string) error    { return s.err }
func (s errPresenceStore) Heartbeat(context.Context, string, string) error  { return s.err }
func (s errPresenceStore) Disconnect(context.Context, string, string) error { return s.err }
func (s errPresenceStore) OnlineUsers(context.Context, []string) ([]string, error) {
	return nil, s.err
}

// TestGetOnlineMembers_StoreError проверяет, что ошибка presence-store пробрасывается
// наверх (для handler это 500), а не маскируется в пустой список online.
func TestGetOnlineMembers_StoreError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	errStore := errPresenceStore{
		err: errRedisDown,
	}

	svc := chat.NewService(db, nil, errStore)

	mockGroupWithMembers(mock, onlineUserID, onlineUserID2, onlineUserID3)

	_, err = svc.GetOnlineMembers(context.Background(), onlineChatID, onlineUserID)
	require.ErrorIs(t, err, errRedisDown)
	require.NoError(t, mock.ExpectationsWereMet())
}
