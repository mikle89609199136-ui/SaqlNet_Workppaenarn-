package chat

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// maxCallParticipants — звонки только один на один (#715).
const maxCallParticipants = 2

type Participant struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName,omitempty"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	joinedAt    int64
}

type callRoom struct {
	id           string
	hostID       string
	roomType     string // "p2p" | "group"
	callKind     string // "video" | "audio"
	chatID       string
	title        string
	createdAt    int64
	answeredAt   int64
	participants map[string]*Participant
}

type RoomSnapshot struct {
	ChatID     string
	CallKind   string
	AnsweredAt int64
	CreatedAt  int64
	HostID     string
	// EndedAt — когда звонок кончился, если не сейчас: комнату, не
	// восстановленную после рестарта, закрывают позже, а оборвался звонок
	// в момент рестарта (#713). 0 — сейчас.
	EndedAt int64
}

type RoomPublic struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	CallKind     string         `json:"callKind"`
	ChatID       string         `json:"chatId"`
	Title        string         `json:"title"`
	HostID       string         `json:"hostId"`
	Participants []*Participant `json:"participants"`
}

type JoinResult struct {
	OK    bool
	Error string
	Peers []*Participant
	// Вход в новую комнату выводит из прежней; если она от этого
	// опустела — закрыта, и её итог нужно записать (#713).
	ClosedRoomID string
	Closed       *RoomSnapshot
}

type LeaveResult struct {
	OK       bool
	Closed   bool
	Snapshot *RoomSnapshot
}

type CallRoomManager struct {
	mu         sync.Mutex
	rooms      map[string]*callRoom
	userToRoom map[string]string
	// restorable — отвеченные звонки, оборванные рестартом сервера: ждут,
	// пока участник войдёт снова (#713).
	restorable map[string]*restorableRoom
}

type restorableRoom struct {
	room    *callRoom
	parties [2]string // звонящий и собеседник — только они поднимают комнату
}

func NewCallRoomManager() *CallRoomManager {
	return &CallRoomManager{
		rooms:      make(map[string]*callRoom),
		userToRoom: make(map[string]string),
		restorable: make(map[string]*restorableRoom),
	}
}

func (m *CallRoomManager) CreateRoom(hostID, roomID, roomType, callKind, chatID, title string) *callRoom {
	m.mu.Lock()
	defer m.mu.Unlock()
	if roomID == "" {
		roomID = fmt.Sprintf("rm_%s%x", randStr(8), time.Now().UnixMilli())
	}
	if r, ok := m.rooms[roomID]; ok {
		return r
	}
	if roomType == "" {
		roomType = "group"
	}
	if callKind == "" {
		callKind = "video"
	}
	r := &callRoom{
		id: roomID, hostID: hostID, roomType: roomType, callKind: callKind,
		chatID: chatID, title: title, createdAt: time.Now().UnixMilli(),
		participants: make(map[string]*Participant),
	}
	m.rooms[roomID] = r
	return r
}

func (m *CallRoomManager) GetRoom(roomID string) *callRoom {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rooms[roomID]
}

// IsParticipant — пользователь сейчас в этой комнате (#849).
func (m *CallRoomManager) IsParticipant(roomID, userID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[roomID]
	if !ok {
		return false
	}
	_, in := r.participants[userID]
	return in
}

func (m *CallRoomManager) GetRoomPublic(roomID string) *RoomPublic {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[roomID]; ok {
		return r.toPublic()
	}
	return nil
}

func (r *callRoom) toPublic() *RoomPublic {
	participants := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		participants = append(participants, p)
	}
	return &RoomPublic{
		ID:           r.id,
		Type:         r.roomType,
		CallKind:     r.callKind,
		ChatID:       r.chatID,
		Title:        r.title,
		HostID:       r.hostID,
		Participants: participants,
	}
}

func (m *CallRoomManager) JoinRoom(roomID, userID, displayName, avatarURL string) JoinResult {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[roomID]
	if !ok {
		return JoinResult{OK: false, Error: "room_not_found"}
	}
	_, alreadyIn := r.participants[userID]
	if len(r.participants) >= maxCallParticipants && !alreadyIn {
		return JoinResult{OK: false, Error: "room_full"}
	}
	var closedID string
	var closed *RoomSnapshot
	if prev, ok := m.userToRoom[userID]; ok && prev != roomID {
		if lr := m.leaveRoomLocked(prev, userID); lr.Closed {
			closedID, closed = prev, lr.Snapshot
		}
	}
	r.participants[userID] = &Participant{
		UserID: userID, DisplayName: displayName, AvatarURL: avatarURL,
		joinedAt: time.Now().UnixMilli(),
	}
	m.userToRoom[userID] = roomID
	if r.answeredAt == 0 && len(r.participants) >= 2 {
		r.answeredAt = time.Now().UnixMilli()
	}
	peers := make([]*Participant, 0, len(r.participants))
	for id, p := range r.participants {
		if id != userID {
			peers = append(peers, p)
		}
	}
	return JoinResult{OK: true, Peers: peers, ClosedRoomID: closedID, Closed: closed}
}

// CloseIfEmpty — закрыть комнату, в которую никто не вошёл (#850).
func (m *CallRoomManager) CloseIfEmpty(roomID string) (*RoomSnapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[roomID]
	if !ok || len(r.participants) > 0 {
		return nil, false
	}
	delete(m.rooms, roomID)
	return &RoomSnapshot{
		ChatID: r.chatID, CallKind: r.callKind,
		AnsweredAt: r.answeredAt, CreatedAt: r.createdAt, HostID: r.hostID,
	}, true
}

// LeaveIfAlone — вывести звонящего из комнаты, где больше никого нет, и
// закрыть её. Нужно, когда звонок кончился без ответа (#713): клиент
// звонящего на отказ не шлёт call_leave, и комната с ним одним иначе
// висела бы до его следующего звонка или отключения.
func (m *CallRoomManager) LeaveIfAlone(roomID, userID string) (*RoomSnapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[roomID]
	if !ok {
		return nil, false
	}
	for id := range r.participants {
		if id != userID {
			return nil, false
		}
	}
	if _, in := r.participants[userID]; !in {
		delete(m.rooms, roomID)
		return &RoomSnapshot{
			ChatID: r.chatID, CallKind: r.callKind,
			AnsweredAt: r.answeredAt, CreatedAt: r.createdAt, HostID: r.hostID,
		}, true
	}
	lr := m.leaveRoomLocked(roomID, userID)
	return lr.Snapshot, lr.Closed
}

func (m *CallRoomManager) LeaveRoom(roomID, userID string) LeaveResult {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.leaveRoomLocked(roomID, userID)
}

func (m *CallRoomManager) GetUserRoom(userID string) *RoomPublic {
	m.mu.Lock()
	defer m.mu.Unlock()
	roomID := m.userToRoom[userID]
	if roomID == "" {
		return nil
	}
	if r, ok := m.rooms[roomID]; ok {
		return r.toPublic()
	}
	return nil
}

func (m *CallRoomManager) leaveRoomLocked(roomID, userID string) LeaveResult {
	r, ok := m.rooms[roomID]
	if !ok {
		return LeaveResult{OK: false}
	}
	// Выйти можно только из комнаты, в которой состоишь.
	if _, in := r.participants[userID]; !in {
		return LeaveResult{OK: false}
	}
	delete(r.participants, userID)
	if m.userToRoom[userID] == roomID {
		delete(m.userToRoom, userID)
	}
	if len(r.participants) == 0 {
		snap := &RoomSnapshot{
			ChatID: r.chatID, CallKind: r.callKind,
			AnsweredAt: r.answeredAt, CreatedAt: r.createdAt, HostID: r.hostID,
		}
		delete(m.rooms, roomID)
		return LeaveResult{OK: true, Closed: true, Snapshot: snap}
	}
	return LeaveResult{OK: true, Closed: false}
}

// ParticipantIDs returns all participant IDs in a room except exceptUserID.
func (m *CallRoomManager) ParticipantIDs(roomID, exceptUserID string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[roomID]
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(r.participants))
	for id := range r.participants {
		if id != exceptUserID {
			ids = append(ids, id)
		}
	}
	return ids
}

const letters = "abcdefghijklmnopqrstuvwxyz0123456789"

func randStr(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// RestorableRoom — звонок, оборванный рестартом сервера, из базы (#713).
type RestorableRoom struct {
	ID, ChatID, CallKind, Title, HostID, CalleeID string
	CreatedAt, AnsweredAt                         int64
}

// AddRestorable — ждать возвращения участников этого звонка.
func (m *CallRoomManager) AddRestorable(r RestorableRoom) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.restorable == nil {
		m.restorable = make(map[string]*restorableRoom)
	}
	m.restorable[r.ID] = &restorableRoom{
		room: &callRoom{
			id: r.ID, hostID: r.HostID, roomType: "p2p", callKind: r.CallKind,
			chatID: r.ChatID, title: r.Title, createdAt: r.CreatedAt, answeredAt: r.AnsweredAt,
			participants: make(map[string]*Participant),
		},
		parties: [2]string{r.HostID, r.CalleeID},
	}
}

// Restore — участник оборванного звонка вернулся: комната снова живая, со
// временем начала и ответа из базы. Посторонний её не поднимает.
func (m *CallRoomManager) Restore(roomID, userID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending, ok := m.restorable[roomID]
	if !ok || userID == "" || (pending.parties[0] != userID && pending.parties[1] != userID) {
		return false
	}
	delete(m.restorable, roomID)
	if _, live := m.rooms[roomID]; !live {
		m.rooms[roomID] = pending.room
	}
	return true
}

// TakeRestorable — никто так и не вернулся: забрать оставшиеся, чтобы
// закрыть.
func (m *CallRoomManager) TakeRestorable() map[string]*RoomSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]*RoomSnapshot, len(m.restorable))
	for id, pending := range m.restorable {
		r := pending.room
		out[id] = &RoomSnapshot{
			ChatID: r.chatID, CallKind: r.callKind,
			AnsweredAt: r.answeredAt, CreatedAt: r.createdAt, HostID: r.hostID,
		}
		delete(m.restorable, id)
	}
	return out
}
