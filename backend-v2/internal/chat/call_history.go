package chat

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"craneapp/backend-v2/internal/platform/privacy"
)

// История звонков (#713).
//
// Комната живёт в памяти (CallRoomManager), а в calls.rooms сервер ведёт,
// чем закончился звонок: кого звали и дошло ли приглашение, когда
// ответили, когда закрылась комната и почему не ответили. Запись — на
// событиях сокета, синхронно: отказ пишется раньше, чем звонящий о нём
// узнает и положит трубку, поэтому итог не перетирается «отменой».
// Ошибка записи звонок не ломает — только пишется в лог.

// Итог неотвеченного звонка, calls.rooms.end_reason.
const (
	callEndAnswered  = "answered"
	callEndDeclined  = "declined"
	callEndBusy      = "busy"
	callEndNoAnswer  = "no_answer"
	callEndCancelled = "cancelled"
)

// callRecordTimeout — запись итога не должна держать сокет.
const callRecordTimeout = 2 * time.Second

// recordCall выполняет запись о комнате, если она есть в базе. Комнаты
// создаются через POST /calls/rooms с id из базы; прочие (тесты без базы) —
// не записываются.
func (ws *WSServer) recordCall(roomID, op, query string, args ...any) {
	if ws.db == nil || validate.Var(roomID, "uuid") != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), callRecordTimeout)
	defer cancel()
	if _, err := ws.db.ExecContext(ctx, query, append([]any{roomID}, args...)...); err != nil {
		slog.Error("call history record", "op", op, "room_id", roomID, "err", err)
	}
}

// recordCallInvited — приглашение дошло до собеседника: звонок появится и
// в его истории.
func (ws *WSServer) recordCallInvited(roomID, calleeID string) {
	ws.recordCall(roomID, "invited", `
		UPDATE calls.rooms
		SET callee_id = $2, invited_at = COALESCE(invited_at, NOW())
		WHERE id = $1`, calleeID)
}

// recordCallRefused — собеседник отклонил, занят или заблокировал. Итог
// первый: повторный отказ в той же комнате его не меняет, ответ — меняет
// (статус считается от answered_at).
func (ws *WSServer) recordCallRefused(roomID, calleeID, reason string) {
	ws.recordCall(roomID, "refused", `
		UPDATE calls.rooms
		SET callee_id = COALESCE(callee_id, $2), end_reason = COALESCE(end_reason, $3)
		WHERE id = $1 AND answered_at IS NULL`, calleeID, reason)
}

// recordCallNoAnswer — приглашение истекло без ответа.
func (ws *WSServer) recordCallNoAnswer(roomID string) {
	ws.recordCall(roomID, "no_answer", `
		UPDATE calls.rooms
		SET end_reason = COALESCE(end_reason, $2)
		WHERE id = $1 AND answered_at IS NULL`, callEndNoAnswer)
}

// recordCallJoined — участник вошёл; второй вошедший — значит, ответили.
// Повторный вход после обрыва (#775) снова открывает участие. Вошедший
// собеседник звонок точно получил — даже если запись приглашения не
// удалась, звонок будет в его истории.
func (ws *WSServer) recordCallJoined(roomID, userID string, answered bool) {
	ws.recordCall(roomID, "joined", `
		INSERT INTO calls.participants (room_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL`, userID)
	ws.recordCall(roomID, "joined_callee", `
		UPDATE calls.rooms
		SET callee_id = COALESCE(callee_id, $2), invited_at = COALESCE(invited_at, NOW())
		WHERE id = $1 AND initiator_id IS DISTINCT FROM $2`, userID)
	if answered {
		ws.recordCall(roomID, "answered", `
			UPDATE calls.rooms SET answered_at = COALESCE(answered_at, NOW()) WHERE id = $1`)
	}
}

// recordCallLeft — участник вышел или оборвалась связь.
func (ws *WSServer) recordCallLeft(roomID, userID string) {
	ws.recordCall(roomID, "left", `
		UPDATE calls.participants SET left_at = NOW()
		WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`, userID)
}

// recordCallEnded — комната закрылась (или звонок оборвался в snap.EndedAt).
// Время ответа берётся и из памяти:
// если запись при входе не удалась, длительность всё равно будет. Без
// ответа и без отказа — звонящий положил трубку.
func (ws *WSServer) recordCallEnded(roomID string, snap *RoomSnapshot) {
	var answeredAt, endedAt sql.NullTime
	if snap != nil && snap.AnsweredAt > 0 {
		answeredAt = sql.NullTime{Time: time.UnixMilli(snap.AnsweredAt), Valid: true}
	}
	if snap != nil && snap.EndedAt > 0 {
		endedAt = sql.NullTime{Time: time.UnixMilli(snap.EndedAt), Valid: true}
	}
	ws.recordCall(roomID, "ended", `
		UPDATE calls.rooms
		SET ended_at = COALESCE($5::timestamptz, NOW()),
		    answered_at = COALESCE(answered_at, $2),
		    end_reason = CASE
		        WHEN COALESCE(answered_at, $2) IS NOT NULL THEN $3
		        ELSE COALESCE(end_reason, $4)
		    END
		WHERE id = $1 AND ended_at IS NULL`, answeredAt, callEndAnswered, callEndCancelled, endedAt)
	ws.recordCall(roomID, "ended_participants", `
		UPDATE calls.participants SET left_at = COALESCE($2::timestamptz, NOW())
		WHERE room_id = $1 AND left_at IS NULL`, endedAt)
}

// Запись истории для зрителя.
type CallHistoryItem struct {
	ID              string     `json:"id"`
	RoomID          string     `json:"roomId"`
	ChatID          *string    `json:"chatId"`
	PeerID          string     `json:"peerId"`
	PeerName        string     `json:"peerName"`
	PeerAvatar      *string    `json:"peerAvatar"`
	Direction       string     `json:"direction"`
	Kind            string     `json:"kind"`
	Status          string     `json:"status"`
	StartedAt       time.Time  `json:"startedAt"`
	AnsweredAt      *time.Time `json:"answeredAt"`
	EndedAt         time.Time  `json:"endedAt"`
	DurationSeconds int        `json:"durationSeconds"`
}

type CallHistoryParams struct {
	Cursor string
	Limit  int
	Kind   string // audio | video | ""
	Status string // answered | missed | rejected | cancelled | ""
}

type CallHistoryPage struct {
	Calls      []CallHistoryItem `json:"calls"`
	NextCursor *string           `json:"nextCursor"`
	HasMore    bool              `json:"hasMore"`
}

const (
	callHistoryDefaultLimit = 50
	callHistoryMaxLimit     = 100
)

// ErrInvalidCallCursor — курсор истории звонков не наш или испорчен.
var ErrInvalidCallCursor = errors.New("invalid call history cursor")

// Курсор — момент начала и id последней записи страницы, непрозрачной
// строкой: клиент его только возвращает.
func encodeCallCursor(startedAt time.Time, id string) string {
	raw := startedAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCallCursor(cursor string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", ErrInvalidCallCursor
	}
	ts, id, ok := strings.Cut(string(raw), "|")
	if !ok || validate.Var(id, "uuid") != nil {
		return time.Time{}, "", ErrInvalidCallCursor
	}
	startedAt, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, "", ErrInvalidCallCursor
	}
	return startedAt, id, nil
}

// CallHistory — завершённые звонки пользователя, от новых к старым.
//
// Свои исходящие — все; входящие — только те, приглашение которых до него
// дошло. Статус — с точки зрения зрителя: неотвеченный исходящий — отменён
// (или отклонён, если собеседник отказал или занят), неотвеченный входящий —
// пропущен (или отклонён, если отказал сам). Звонки без собеседника (чат
// удалён, а позвать не успели) не показываются.
func (s *Service) CallHistory(ctx context.Context, userID string, params CallHistoryParams) (CallHistoryPage, error) {
	limit := params.Limit
	if limit <= 0 {
		limit = callHistoryDefaultLimit
	}
	if limit > callHistoryMaxLimit {
		limit = callHistoryMaxLimit
	}

	var cursorAt sql.NullTime
	var cursorID sql.NullString
	if params.Cursor != "" {
		at, id, err := decodeCallCursor(params.Cursor)
		if err != nil {
			return CallHistoryPage{}, err
		}
		cursorAt = sql.NullTime{Time: at, Valid: true}
		cursorID = sql.NullString{String: id, Valid: true}
	}
	dbKind := sql.NullString{}
	switch params.Kind {
	case "":
	case "audio":
		dbKind = sql.NullString{String: "voice", Valid: true}
	case "video":
		dbKind = sql.NullString{String: "video", Valid: true}
	default:
		return CallHistoryPage{}, ErrInvalidInput
	}
	status := sql.NullString{}
	switch params.Status {
	case "":
	case "answered", "missed", "rejected", "cancelled":
		status = sql.NullString{String: params.Status, Valid: true}
	default:
		return CallHistoryPage{}, ErrInvalidInput
	}

	rows, err := s.db.QueryContext(ctx, `
		WITH mine AS (
			SELECT r.id, r.chat_id, r.type, r.created_at, r.answered_at, r.ended_at,
			       r.initiator_id = $1 AS outgoing,
			       CASE WHEN r.initiator_id = $1
			            THEN COALESCE(r.callee_id, (
			                SELECT m.user_id FROM chats.members m
			                WHERE m.chat_id = r.chat_id AND m.user_id <> $1
			                LIMIT 1))
			            ELSE r.initiator_id
			       END AS peer_id,
			       CASE
			           WHEN r.answered_at IS NOT NULL THEN 'answered'
			           WHEN r.end_reason = 'declined' THEN 'rejected'
			           WHEN r.initiator_id = $1 AND r.end_reason = 'busy' THEN 'rejected'
			           WHEN r.initiator_id = $1 THEN 'cancelled'
			           ELSE 'missed'
			       END AS status
			FROM calls.rooms r
			WHERE r.ended_at IS NOT NULL
			  AND (r.initiator_id = $1 OR (r.callee_id = $1 AND r.invited_at IS NOT NULL))
			  AND ($2::text IS NULL OR r.type = $2)
			  AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3, $4::uuid))
		)
		SELECT mine.id::text, mine.chat_id::text, mine.peer_id::text,
		       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), NULLIF(au.first_name, ''), au.username, ''),
		       COALESCE(up.avatar_url, ''),
		       mine.outgoing, mine.type, mine.status,
		       mine.created_at, mine.answered_at, mine.ended_at
		FROM mine
		LEFT JOIN auth.users au ON au.id = mine.peer_id
		LEFT JOIN users.profiles up ON up.user_id = mine.peer_id
		WHERE mine.peer_id IS NOT NULL
		  AND ($5::text IS NULL OR mine.status = $5)
		ORDER BY mine.created_at DESC, mine.id DESC
		LIMIT $6
	`, userID, dbKind, cursorAt, cursorID, status, limit+1)
	if err != nil {
		return CallHistoryPage{}, err
	}
	defer rows.Close()

	calls := make([]CallHistoryItem, 0, limit)
	avatars := make([]string, 0, limit)
	for rows.Next() {
		var item CallHistoryItem
		var chatID sql.NullString
		var avatar, dbType string
		var outgoing bool
		var answeredAt sql.NullTime
		if err := rows.Scan(&item.ID, &chatID, &item.PeerID, &item.PeerName, &avatar,
			&outgoing, &dbType, &item.Status, &item.StartedAt, &answeredAt, &item.EndedAt); err != nil {
			return CallHistoryPage{}, err
		}
		item.RoomID = item.ID
		if chatID.Valid {
			item.ChatID = &chatID.String
		}
		item.Direction = "incoming"
		if outgoing {
			item.Direction = "outgoing"
		}
		item.Kind = "video"
		if dbType == "voice" {
			item.Kind = "audio"
		}
		if answeredAt.Valid {
			at := answeredAt.Time
			item.AnsweredAt = &at
			if d := item.EndedAt.Sub(at); d > 0 {
				item.DurationSeconds = int(d / time.Second)
			}
		}
		calls = append(calls, item)
		avatars = append(avatars, avatar)
	}
	if err := rows.Err(); err != nil {
		return CallHistoryPage{}, err
	}

	page := CallHistoryPage{Calls: calls}
	if len(calls) > limit {
		page.Calls = calls[:limit]
		avatars = avatars[:limit]
		last := page.Calls[limit-1]
		next := encodeCallCursor(last.StartedAt, last.ID)
		page.NextCursor = &next
		page.HasMore = true
	}

	// Аватар собеседника — по правилу «Фото» (#789), как в приглашении.
	slots := make([]privacy.PhotoSlot, len(page.Calls))
	for i := range page.Calls {
		slots[i] = privacy.PhotoSlot{OwnerID: page.Calls[i].PeerID, URL: &avatars[i]}
	}
	if err := privacy.HidePhotos(ctx, s.db, userID, slots); err != nil {
		return CallHistoryPage{}, fmt.Errorf("call history photos: %w", err)
	}
	for i := range page.Calls {
		if avatars[i] != "" {
			url := avatars[i]
			page.Calls[i].PeerAvatar = &url
		}
	}
	return page, nil
}
