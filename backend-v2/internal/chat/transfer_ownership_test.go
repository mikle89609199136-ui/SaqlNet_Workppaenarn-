package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

const (
	transferOwnerIDQuery = `SELECT owner_id FROM chats.chats WHERE id = $1 FOR UPDATE`
	transferTargetQuery  = `SELECT role FROM chats.members WHERE chat_id = $1 AND user_id = $2 FOR UPDATE`
	transferChatUpdate   = `UPDATE chats.chats SET owner_id = $1, updated_at = NOW() WHERE id = $2`
	transferTargetUpdate = `UPDATE chats.members SET role = 'owner' WHERE chat_id = $1 AND user_id = $2`
	transferActorUpdate  = `UPDATE chats.members SET role = 'member' WHERE chat_id = $1 AND user_id = $2`
	transferActorID      = "550e8400-e29b-41d4-a716-446655440001" // прежний владелец
	transferChatID       = "550e8400-e29b-41d4-a716-446655440002"
	transferTargetID     = "550e8400-e29b-41d4-a716-446655440003" // новый владелец
	transferOtherOwnerID = "550e8400-e29b-41d4-a716-446655440009" // владелец, подменивший актора
)

// expectOwnerLock мокирует SELECT ... FOR UPDATE по chats.chats с заданным owner_id.
func expectOwnerLock(mock sqlmock.Sqlmock, ownerID string) {
	mock.ExpectQuery(transferOwnerIDQuery).
		WithArgs(transferChatID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(ownerID))
}

// expectTargetLock мокирует SELECT ... FOR UPDATE по membership-строке target.
func expectTargetLock(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(transferTargetQuery).
		WithArgs(transferChatID, transferTargetID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
}

// TestTransferOwnership_Success_ownerTransfers проверяет транзакционную передачу владения:
// внутри одной транзакции блокируются чат и membership target (FOR UPDATE),
// затем обновляются owner_id в chats.chats и роли обеих сторон,
// каждый UPDATE затрагивает ровно одну строку.
func TestTransferOwnership_Success_ownerTransfers(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferActorID)
	expectTargetLock(mock)
	mock.ExpectExec(transferChatUpdate).
		WithArgs(transferTargetID, transferChatID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(transferTargetUpdate).
		WithArgs(transferChatID, transferTargetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(transferActorUpdate).
		WithArgs(transferChatID, transferActorID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_OwnershipConflict проверяет гонку: на момент SELECT ... FOR UPDATE
// владельцем чата уже является другой пользователь — ROLLBACK и ErrOwnershipConflict,
// UPDATE-операции не выполняются.
func TestTransferOwnership_OwnershipConflict(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferOtherOwnerID)
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.ErrorIs(t, err, chat.ErrOwnershipConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_ChatNotFound проверяет: чат не найден на этапе
// SELECT ... FOR UPDATE — ROLLBACK и ErrNotFound.
func TestTransferOwnership_ChatNotFound(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	mock.ExpectQuery(transferOwnerIDQuery).
		WithArgs(transferChatID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.ErrorIs(t, err, chat.ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_TargetNotMember проверяет, что нельзя передать владение
// пользователю, не состоящему в чате: membership-строка target отсутствует
// на этапе SELECT ... FOR UPDATE — ROLLBACK и ErrNotMember.
func TestTransferOwnership_TargetNotMember(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferActorID)
	mock.ExpectQuery(transferTargetQuery).
		WithArgs(transferChatID, transferTargetID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.ErrorIs(t, err, chat.ErrNotMember)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_SelfTransfer проверяет запрет передачи самому себе:
// возвращается ErrInvalidInput. (Note: проверка должна сработать до SQL-запросов.)
func TestTransferOwnership_SelfTransfer(t *testing.T) {
	db, _, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferActorID)
	require.ErrorIs(t, err, chat.ErrInvalidInput)
}

// TestTransferOwnership_InvalidUUID проверяет отказ при невалидных UUID:
// возвращается ErrInvalidInput, обращений к БД нет.
func TestTransferOwnership_InvalidUUID(t *testing.T) {
	db, _, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, "not-a-uuid")
	require.ErrorIs(t, err, chat.ErrInvalidInput)
}

// TestTransferOwnership_RollbackOnUpdateError проверяет откат транзакции:
// если первый UPDATE (owner_id в chats.chats) падает, транзакция откатывается,
// исходная ошибка возвращается. Последующие UPDATE не должны выполниться.
func TestTransferOwnership_RollbackOnUpdateError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferActorID)
	expectTargetLock(mock)
	mock.ExpectExec(transferChatUpdate).
		WithArgs(transferTargetID, transferChatID).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.Error(t, err)
	require.ErrorIs(t, err, sql.ErrConnDone)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_ChatDeletedMidTx проверяет гонку: чат удалён между
// блокировкой и UPDATE chats.chats (RowsAffected=0) — ROLLBACK и ErrNotFound.
func TestTransferOwnership_ChatDeletedMidTx(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferActorID)
	expectTargetLock(mock)
	mock.ExpectExec(transferChatUpdate).
		WithArgs(transferTargetID, transferChatID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.ErrorIs(t, err, chat.ErrNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_TargetLeftMidTx проверяет гонку: target покинул чат
// перед обновлением его роли (RowsAffected=0) — ROLLBACK и ErrNotMember.
func TestTransferOwnership_TargetLeftMidTx(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferActorID)
	expectTargetLock(mock)
	mock.ExpectExec(transferChatUpdate).
		WithArgs(transferTargetID, transferChatID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(transferTargetUpdate).
		WithArgs(transferChatID, transferTargetID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.ErrorIs(t, err, chat.ErrNotMember)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTransferOwnership_ActorMembershipLostMidTx проверяет гонку: membership-строка
// актора исчезла перед обновлением его роли (RowsAffected=0) — ROLLBACK и ErrOwnershipConflict.
func TestTransferOwnership_ActorMembershipLostMidTx(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	mock.ExpectBegin()
	expectOwnerLock(mock, transferActorID)
	expectTargetLock(mock)
	mock.ExpectExec(transferChatUpdate).
		WithArgs(transferTargetID, transferChatID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(transferTargetUpdate).
		WithArgs(transferChatID, transferTargetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(transferActorUpdate).
		WithArgs(transferChatID, transferActorID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err = svc.TransferOwnership(context.Background(), transferActorID, transferChatID, transferTargetID)
	require.ErrorIs(t, err, chat.ErrOwnershipConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}
