package chat

import (
	"context"
	"database/sql"
	"time"
)

// Звонки после рестарта сервера (#713).
//
// Комнаты живут в памяти процесса, поэтому рестарт их теряет, хотя сам
// разговор идёт напрямую между собеседниками и рестарт переживает. Клиент
// после переподключения сокета входит в комнату снова (rejoinActiveCall) —
// этим входом комната и поднимается из базы.
//
// При старте сервер находит незакрытые комнаты, оборванные рестартом:
//   - отвеченные ждут участников callRestoreGrace; кто вернулся — звонок
//     продолжается с прежним временем ответа, кто нет — закрывается с
//     окончанием в момент рестарта;
//   - неотвеченные закрываются сразу: приглашение потеряно, а звонящий
//     перестанет ждать по своему таймауту.
//
// Оборванными считаются только комнаты, в которые входили (есть запись в
// calls.participants, её ведёт сервер с #713), и не старше
// callOrphanMaxAge: давние незакрытые комнаты — не следствие этого рестарта.

// callRestoreGrace — сколько ждать участников оборванного звонка: клиент
// переподключается за секунды и сам ждёт собеседника 25 с. Переменная — для
// тестов.
var callRestoreGrace = 2 * time.Minute

// callOrphanMaxAge — комнаты старше не восстанавливаются и не закрываются.
const callOrphanMaxAge = 6 * time.Hour

// RecoverCallRooms вызывается один раз при старте сервиса.
func (ws *WSServer) RecoverCallRooms(ctx context.Context) error {
	if ws.db == nil {
		return nil
	}
	startedAt := time.Now()
	rows, err := ws.db.QueryContext(ctx, `
		SELECT r.id::text, COALESCE(r.chat_id::text, ''), r.type, r.title,
		       COALESCE(r.initiator_id::text, ''), COALESCE(r.callee_id::text, ''),
		       r.created_at, r.answered_at
		FROM calls.rooms r
		WHERE r.ended_at IS NULL
		  AND r.created_at > $1
		  AND EXISTS (SELECT 1 FROM calls.participants p WHERE p.room_id = r.id)`,
		startedAt.Add(-callOrphanMaxAge))
	if err != nil {
		return err
	}
	var orphans []RestorableRoom
	for rows.Next() {
		var r RestorableRoom
		var dbType string
		var createdAt time.Time
		var answeredAt sql.NullTime
		if err := rows.Scan(&r.ID, &r.ChatID, &dbType, &r.Title, &r.HostID, &r.CalleeID, &createdAt, &answeredAt); err != nil {
			rows.Close()
			return err
		}
		r.CallKind = "video"
		if dbType == "voice" {
			r.CallKind = "audio"
		}
		r.CreatedAt = createdAt.UnixMilli()
		if answeredAt.Valid {
			r.AnsweredAt = answeredAt.Time.UnixMilli()
		}
		orphans = append(orphans, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	waiting := 0
	for _, r := range orphans {
		if r.AnsweredAt > 0 {
			ws.callRooms.AddRestorable(r)
			waiting++
			continue
		}
		ws.closeCallRoom(r.ID, &RoomSnapshot{
			ChatID: r.ChatID, CallKind: r.CallKind, CreatedAt: r.CreatedAt, HostID: r.HostID,
			EndedAt: startedAt.UnixMilli(),
		}, false)
	}
	if waiting > 0 {
		time.AfterFunc(callRestoreGrace, func() { ws.closeUnrestoredCalls(startedAt) })
	}
	return nil
}

// closeUnrestoredCalls — участники оборванного звонка не вернулись: звонок
// кончился в момент рестарта. «Пропущенный» push не нужен — ответили.
func (ws *WSServer) closeUnrestoredCalls(startedAt time.Time) {
	for roomID, snap := range ws.callRooms.TakeRestorable() {
		snap.EndedAt = startedAt.UnixMilli()
		ws.closeCallRoom(roomID, snap, false)
	}
}
