package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

// Событие «печатает» (#866).
//
// Раньше сервер пересылал объект клиента целиком и на каждое событие трижды
// ходил в базу. Теперь:
//   - рассылается только type, chatId, userId (senderId — на переходный
//     период) и firstName, собранные сервером;
//   - участники чата и их имена берутся из кеша в памяти: при прогретом
//     кеше событие не трогает базу;
//   - частоту режет сервер, а не только клиент.
//
// Кеш — только для «печатает». Общая рассылка (BroadcastToChat) читает
// участников из базы: устаревший кеш не должен доставить сообщение
// исключённому. Кеш сбрасывается, когда сервис чатов меняет состав
// участников, и живёт не дольше typingMembersTTL — это покрывает изменения
// из других сервисов (удаление аккаунта, смена имени).

const (
	typingMembersTTL      = 30 * time.Second
	typingMembersMaxChats = 10_000
	// Не чаще раза в секунду на пару (пользователь, чат): клиент шлёт раз
	// в полторы секунды, лишнее — шум.
	typingMinInterval = time.Second
	// И не больше десяти событий в секунду от пользователя по всем чатам:
	// иначе перебор чужих chatId гонял бы запросы в базу.
	typingUserMinInterval = 100 * time.Millisecond
	typingLimiterMaxKeys  = 100_000
	typingLoadTimeout     = 3 * time.Second
)

// typingEvent — всё, что уходит получателям. Других полей нет.
type typingEvent struct {
	Type      string `json:"type"`
	ChatID    string `json:"chatId"`
	UserID    string `json:"userId"`
	SenderID  string `json:"senderId"`
	FirstName string `json:"firstName"`
}

// chatMembersLoader возвращает участников чата: id → имя для подписи.
type chatMembersLoader func(ctx context.Context, chatID string) (map[string]string, error)

type chatMembersEntry struct {
	members  map[string]string
	loadedAt time.Time
}

type typingMembersCache struct {
	mu      sync.Mutex
	entries map[string]chatMembersEntry
	// generation растёт при каждом сбросе: загрузка, начатая до сброса, не
	// кладёт в кеш устаревший список.
	generation uint64
	load       chatMembersLoader
	now        func() time.Time
}

func newTypingMembersCache(load chatMembersLoader, now func() time.Time) *typingMembersCache {
	return &typingMembersCache{entries: make(map[string]chatMembersEntry), load: load, now: now}
}

func (c *typingMembersCache) get(ctx context.Context, chatID string) (map[string]string, error) {
	c.mu.Lock()
	entry, ok := c.entries[chatID]
	generation := c.generation
	c.mu.Unlock()
	if ok && c.now().Sub(entry.loadedAt) < typingMembersTTL {
		return entry.members, nil
	}

	members, err := c.load(ctx, chatID)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.generation == generation {
		if len(c.entries) >= typingMembersMaxChats {
			c.evictExpiredLocked()
		}
		if len(c.entries) >= typingMembersMaxChats {
			c.entries = make(map[string]chatMembersEntry)
		}
		c.entries[chatID] = chatMembersEntry{members: members, loadedAt: c.now()}
	}
	return members, nil
}

func (c *typingMembersCache) evictExpiredLocked() {
	now := c.now()
	for chatID, entry := range c.entries {
		if now.Sub(entry.loadedAt) >= typingMembersTTL {
			delete(c.entries, chatID)
		}
	}
}

// invalidateChat забывает участников чата: вступивший сразу получает
// события, исключённый — сразу перестаёт.
func (c *typingMembersCache) invalidateChat(chatID string) {
	c.mu.Lock()
	delete(c.entries, chatID)
	c.generation++
	c.mu.Unlock()
}

// invalidateUser забывает чаты, где есть пользователь, — после смены имени.
func (c *typingMembersCache) invalidateUser(userID string) {
	c.mu.Lock()
	for chatID, entry := range c.entries {
		if _, ok := entry.members[userID]; ok {
			delete(c.entries, chatID)
		}
	}
	c.generation++
	c.mu.Unlock()
}

type typingLimiter struct {
	mu   sync.Mutex
	last map[string]time.Time
	now  func() time.Time
}

func newTypingLimiter(now func() time.Time) *typingLimiter {
	return &typingLimiter{last: make(map[string]time.Time), now: now}
}

// allow — можно ли разослать «печатает» от userID в chatID сейчас.
// Лишние события молча отбрасываются.
func (l *typingLimiter) allow(userID, chatID string) bool {
	now := l.now()
	pairKey := userID + "\x00" + chatID
	userKey := userID

	l.mu.Lock()
	defer l.mu.Unlock()
	if last, ok := l.last[userKey]; ok && now.Sub(last) < typingUserMinInterval {
		return false
	}
	if last, ok := l.last[pairKey]; ok && now.Sub(last) < typingMinInterval {
		return false
	}
	if len(l.last) >= typingLimiterMaxKeys {
		for key, last := range l.last {
			if now.Sub(last) >= typingMinInterval {
				delete(l.last, key)
			}
		}
		if len(l.last) >= typingLimiterMaxKeys {
			l.last = make(map[string]time.Time)
		}
	}
	l.last[userKey] = now
	l.last[pairKey] = now
	return true
}

type typingState struct {
	members *typingMembersCache
	limiter *typingLimiter
}

// typing — состояние «печатает», создаётся при первом обращении: тесты
// собирают WSServer литералом, без конструктора.
func (ws *WSServer) typing() *typingState {
	ws.typingOnce.Do(func() {
		load := ws.typingMembersLoader
		if load == nil {
			load = ws.loadChatMembersForTyping
		}
		now := ws.typingClock
		if now == nil {
			now = time.Now
		}
		ws.typingState = &typingState{
			members: newTypingMembersCache(load, now),
			limiter: newTypingLimiter(now),
		}
	})
	return ws.typingState
}

var errNoDatabase = errors.New("database is not configured")

func (ws *WSServer) loadChatMembersForTyping(ctx context.Context, chatID string) (map[string]string, error) {
	if ws.db == nil {
		return nil, errNoDatabase
	}
	rows, err := ws.db.QueryContext(ctx, `
		SELECT m.user_id::text,
		       COALESCE(NULLIF(up.first_name, ''), NULLIF(au.first_name, ''), au.username, '')
		FROM chats.members m
		LEFT JOIN auth.users au ON au.id = m.user_id
		LEFT JOIN users.profiles up ON up.user_id = m.user_id
		WHERE m.chat_id = $1
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make(map[string]string)
	for rows.Next() {
		var userID string
		var name sql.NullString
		if err := rows.Scan(&userID, &name); err != nil {
			return nil, err
		}
		members[userID] = name.String
	}
	return members, rows.Err()
}

// handleTyping рассылает «печатает» остальным участникам чата. Не участник,
// слишком частые события и некорректный chatId — молча отбрасываются.
func (ws *WSServer) handleTyping(userID, chatID string) {
	if validate.Var(chatID, "required,uuid") != nil {
		return
	}
	state := ws.typing()
	if !state.limiter.allow(userID, chatID) {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), typingLoadTimeout)
	defer cancel()
	members, err := state.members.get(ctx, chatID)
	if err != nil {
		return
	}
	firstName, isMember := members[userID]
	if !isMember {
		return
	}

	payload, err := json.Marshal(typingEvent{
		Type:      "typing",
		ChatID:    chatID,
		UserID:    userID,
		SenderID:  userID,
		FirstName: firstName,
	})
	if err != nil {
		return
	}
	recipients := make([]string, 0, len(members))
	for memberID := range members {
		if memberID != userID {
			recipients = append(recipients, memberID)
		}
	}
	ws.BroadcastToUsers(recipients, payload)
}

// InvalidateChatMembers — состав участников чата изменился.
func (ws *WSServer) InvalidateChatMembers(chatID string) {
	if ws == nil {
		return
	}
	ws.typing().members.invalidateChat(chatID)
}

// InvalidateUserProfile — у пользователя сменилось имя.
func (ws *WSServer) InvalidateUserProfile(userID string) {
	if ws == nil {
		return
	}
	ws.typing().members.invalidateUser(userID)
}
