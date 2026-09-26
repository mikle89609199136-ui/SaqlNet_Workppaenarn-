package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"craneapp/backend-v2/internal/platform/privacy"
)

// Присутствие собеседников (#780).
//
// Кто подключён, WSServer знает сам, а наружу это уходило только снимком в
// данных чата: статус «в сети» не менялся без перезагрузки страницы. Теперь
// при первом подключении и при закрытии последнего соединения собеседникам
// по личным чатам уходит presence_changed, а время активности пишется в
// users.presence — оттуда его читают данные чата и GET /users/{id}/status.

// «В сети» читатели считают по отметке свежее presence.LeaseTTL (75 с):
// heartbeat идёт раз в wsPingInterval, окно — с запасом в два пропущенных.
// Число записано прямо в SQL данных чата и GET /users/{id}/status.
const presenceChangedType = "presence_changed"

// presenceActivity хранит время активности и знает, кому о ней сообщать.
type presenceActivity interface {
	// Touch отмечает пользователя в сети или вне её и возвращает время
	// последней активности.
	Touch(ctx context.Context, userID string, online bool) (time.Time, error)
	// Audience — собеседники по личным чатам, которым виден статус.
	Audience(ctx context.Context, userID string) (peers []string, err error)
}

type dbPresenceActivity struct {
	db *sql.DB
}

func (a dbPresenceActivity) Touch(ctx context.Context, userID string, online bool) (time.Time, error) {
	var lastSeen time.Time
	err := a.db.QueryRowContext(ctx, `
		INSERT INTO users.presence (user_id, online, last_seen_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET online = EXCLUDED.online, last_seen_at = EXCLUDED.last_seen_at
		RETURNING last_seen_at`, userID, online).Scan(&lastSeen)
	return lastSeen, err
}

// Audience решает по каждому собеседнику общей проверкой приватности
// (#783, #784): правило «Последняя активность», блокировка и исключения —
// так же, как GET /users/{id}/status и данные чата.
func (a dbPresenceActivity) Audience(ctx context.Context, userID string) ([]string, error) {
	var raw []byte
	err := a.db.QueryRowContext(ctx, `
		SELECT privacy_settings FROM users.settings WHERE user_id = $1`, userID).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	settings := privacy.Parse(raw)

	rows, err := a.db.QueryContext(ctx, `
		SELECT DISTINCT peer.user_id::text,
		       EXISTS(SELECT 1 FROM users.blocked_users b WHERE b.user_id = $1 AND b.blocked_user_id = peer.user_id),
		       (SELECT jsonb_object_agg(e.rule, e.allow) FROM users.privacy_exceptions e WHERE e.owner_id = $1 AND e.user_id = peer.user_id)
		FROM chats.members me
		JOIN chats.chats c ON c.id = me.chat_id AND c.type = 'private'
		JOIN chats.members peer ON peer.chat_id = me.chat_id AND peer.user_id <> me.user_id
		WHERE me.user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var peers []string
	for rows.Next() {
		var peer string
		var blocked bool
		var exceptions []byte
		if err := rows.Scan(&peer, &blocked, &exceptions); err != nil {
			return nil, err
		}
		relation := privacy.Relation{Blocked: blocked, Exceptions: privacy.ParseExceptions(exceptions)}
		if privacy.Decide(settings, relation, privacy.LastSeen) {
			peers = append(peers, peer)
		}
	}
	return peers, rows.Err()
}

// isOnlineElsewhere — есть ли у пользователя живые соединения, кроме
// except. С общим presence.Store учитываются соединения всех экземпляров
// сервиса, без него — только этого.
func (ws *WSServer) isOnlineElsewhere(ctx context.Context, userID string, except *Client) bool {
	if ws.presence != nil {
		online, err := ws.presence.OnlineUsers(ctx, []string{userID})
		if err == nil {
			return len(online) > 0
		}
		slog.Error("presence lookup error", "userID", userID, "err", err)
	}

	ws.mu.RLock()
	defer ws.mu.RUnlock()
	for client := range ws.clients[userID] {
		if client != except {
			return true
		}
	}
	return false
}

// announcePresence записывает переход и сообщает о нём собеседникам.
// Ошибки только логируются: статус — не повод ломать соединение.
func (ws *WSServer) announcePresence(userID string, online bool) {
	if ws.activity == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	lastSeen, err := ws.activity.Touch(ctx, userID, online)
	if err != nil {
		slog.Error("presence touch error", "userID", userID, "err", err)
		return
	}
	peers, err := ws.activity.Audience(ctx, userID)
	if err != nil {
		slog.Error("presence audience error", "userID", userID, "err", err)
		return
	}
	// Тем, от кого статус скрыт, событие не уходит вовсе: они и так видят
	// «был(а) недавно», а само событие выдало бы, когда человек в сети.
	if len(peers) == 0 {
		return
	}

	payload, _ := json.Marshal(map[string]any{
		"type":     presenceChangedType,
		"userId":   userID,
		"isOnline": online,
		"lastSeen": lastSeen.UTC().Format(time.RFC3339),
	})
	ws.BroadcastToUsers(peers, payload)
}

// announceOffline сообщает о выходе, если после закрытия client у
// пользователя не осталось соединений. Проверка повторяется здесь: человек
// мог переподключиться, пока закрывалось старое соединение, и запоздалое
// «вышел» затёрло бы свежее «в сети».
func (ws *WSServer) announceOffline(client *Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if ws.isOnlineElsewhere(ctx, client.UserID, client) {
		return
	}
	ws.announcePresence(client.UserID, false)
}

// touchPresence продлевает отметку «в сети» по heartbeat.
func (ws *WSServer) touchPresence(userID string) {
	if ws.activity == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := ws.activity.Touch(ctx, userID, true); err != nil {
		slog.Error("presence touch error", "userID", userID, "err", err)
	}
}
