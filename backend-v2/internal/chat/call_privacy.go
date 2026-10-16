package chat

import (
	"context"
	"database/sql"
	"log/slog"

	"craneapp/backend-v2/internal/platform/privacy"
)

// calls — каноническое правило «Кто может звонить» (#714, #783).
// Контактов нет: all / nobody и исключения по людям. Блокировка получателем
// сильнее исключений. Ошибка чтения не разрешает звонок.
func checkCallPrivacy(ctx context.Context, db *sql.DB, calleeID, callerID string) error {
	if db == nil {
		return ErrCallsForbidden
	}
	settings, relation, err := privacy.Load(ctx, db, calleeID, callerID)
	if err != nil {
		return err
	}
	if relation.Blocked {
		return ErrBlockedByUser
	}
	if !privacy.Decide(settings, relation, privacy.Calls) {
		return ErrCallsForbidden
	}
	return nil
}

// Проверяем исходное направление звонка и при входе любого участника,
// включая повторный вход: настройки владельца комнаты не ограничивают
// его исходящие звонки, проверяются настройки получателя.
func (ws *WSServer) allowCallRoomJoin(chatID, callerID string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), callRecordTimeout)
	defer cancel()
	var calleeID string
	err := ws.db.QueryRowContext(ctx, `
		SELECT user_id::text FROM chats.members
		WHERE chat_id = $1 AND user_id <> $2 LIMIT 1`, chatID, callerID).Scan(&calleeID)
	if err == nil {
		err = checkCallPrivacy(ctx, ws.db, calleeID, callerID)
	}
	if err != nil {
		slog.Debug("call join privacy denied", "err", err)
	}
	return err == nil
}

// closeDeniedCallRoom освобождает звонящего и закрывает существующие строки,
// не создавая call-message, «пропущенный» push или новые записи истории.
// Отвеченные и ожидающие восстановления комнаты здесь не удаляются.
func (ws *WSServer) closeDeniedCallRoom(roomID, callerID string) {
	if snap, closed := ws.callRooms.CloseUnanswered(roomID, callerID); closed {
		ws.recordCallEnded(roomID, snap)
		ws.cancelInvitesForRoom(roomID)
	}
}
