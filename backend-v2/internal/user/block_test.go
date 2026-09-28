package user

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/platform/blockevent"
)

const (
	blockOwner  = "11111111-1111-4111-8111-111111111111"
	blockTarget = "22222222-2222-4222-8222-222222222222"
)

// blockEventArg — уведомление о блокировке в pg_notify.
type blockEventArg struct{ blocked bool }

func (a blockEventArg) Match(value driver.Value) bool {
	raw, ok := value.(string)
	if !ok {
		return false
	}
	var event blockevent.Changed
	return json.Unmarshal([]byte(raw), &event) == nil &&
		event == blockevent.Changed{UserID: blockOwner, BlockedUserID: blockTarget, Blocked: a.blocked}
}

// Блокировка и её снятие уведомляют сервис chat тем же запросом (#760).
func TestBlockNotifiesChatService(t *testing.T) {
	expectTarget := func(mock sqlmock.Sqlmock) {
		mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).WithArgs(blockTarget).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	}

	t.Run("блокировка", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		expectTarget(mock)
		mock.ExpectExec(`(?s)WITH inserted AS \(\s+INSERT INTO users\.blocked_users.*SELECT pg_notify\(\$3, \$4\) FROM inserted`).
			WithArgs(blockOwner, blockTarget, blockevent.Channel, blockEventArg{blocked: true}).
			WillReturnResult(sqlmock.NewResult(0, 1))

		require.NoError(t, NewService(db).Block(context.Background(), blockOwner, blockTarget))
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("уже заблокирован — без уведомления и с ошибкой", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		expectTarget(mock)
		// Строка не вставлена — SELECT из пустого inserted не вызывает pg_notify.
		mock.ExpectExec(`WITH inserted AS`).WillReturnResult(sqlmock.NewResult(0, 0))

		require.ErrorIs(t, NewService(db).Block(context.Background(), blockOwner, blockTarget), ErrAlreadyBlocked)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("снятие блокировки", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer db.Close()
		mock.ExpectExec(`(?s)WITH deleted AS \(\s+DELETE FROM users\.blocked_users.*SELECT pg_notify\(\$3, \$4\) FROM deleted`).
			WithArgs(blockOwner, blockTarget, blockevent.Channel, blockEventArg{blocked: false}).
			WillReturnResult(sqlmock.NewResult(0, 1))

		require.NoError(t, NewService(db).Unblock(context.Background(), blockOwner, blockTarget))
		require.NoError(t, mock.ExpectationsWereMet())
	})
}
