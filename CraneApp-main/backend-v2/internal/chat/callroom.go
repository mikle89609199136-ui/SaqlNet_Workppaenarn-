package chat

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

const maxCallParticipants = 5

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
}

func NewCallRoomManager() *CallRoomManager {
	return &CallRoomManager{
		rooms:      make(map[string]*callRoom),
		userToRoom: make(map[string]string),
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

func (m *CallRoomManager) GetRoomPublic(roomID string) *RoomPublic {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[roomID]; ok {
		return r.toPublic()
	}
	return nil
}

func (m *CallRoomManager) ListRoomsPublic() []*RoomPublic {
	m.mu.Lock()
	defer m.mu.Unlock()
	res := make([]*RoomPublic, 0, len(m.rooms))
	for _, r := range m.rooms {
		res = append(res, r.toPublic())
	}
	return res
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
	if prev, ok := m.userToRoom[userID]; ok && prev != roomID {
		m.leaveRoomLocked(prev, userID)
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
	return JoinResult{OK: true, Peers: peers}
}

func (m *CallRoomManager) LeaveRoom(roomID, userID string) LeaveResult {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.leaveRoomLocked(roomID, userID)
}

func (m *CallRoomManager) leaveRoomLocked(roomID, userID string) LeaveResult {
	r, ok := m.rooms[roomID]
	if !ok {
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
