package presence

import (
	"context"
	"sync"
	"time"
)

// MemoryStore — in-memory реализация Store для тестов и локальной разработки.
// Хранит lease в виде userID → connectionID → expiresAt; источник времени
// передан извне, чтобы TTL можно было тестировать без sleep.
type MemoryStore struct {
	now    func() time.Time
	mu     sync.Mutex
	leases map[string]map[string]time.Time
}

// NewMemoryStore создаёт MemoryStore с заданным источником текущего времени.
// Если now == nil, по умолчанию используется time.Now.
func NewMemoryStore(now func() time.Time) *MemoryStore {
	if now == nil {
		now = time.Now
	}
	return &MemoryStore{
		now:    now,
		leases: make(map[string]map[string]time.Time),
	}
}

// Connect добавляет lease соединения со сроком жизни LeaseTTL.
func (s *MemoryStore) Connect(ctx context.Context, userID, connectionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	conns, ok := s.leases[userID]
	if !ok {
		conns = make(map[string]time.Time)
		s.leases[userID] = conns
	}
	conns[connectionID] = s.now().Add(LeaseTTL)
	return nil
}

// Heartbeat продлевает или восстанавливает lease конкретного соединения на LeaseTTL.
func (s *MemoryStore) Heartbeat(ctx context.Context, userID, connectionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	conns, ok := s.leases[userID]
	if !ok {
		conns = make(map[string]time.Time)
		s.leases[userID] = conns
	}
	conns[connectionID] = s.now().Add(LeaseTTL)
	return nil
}

// Disconnect удаляет lease соединения; отсутствующий lease — no-op.
func (s *MemoryStore) Disconnect(ctx context.Context, userID, connectionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.leases[userID], connectionID)
	return nil
}

// isUserOnlineLocked проверяет наличие активных lease у пользователя,
// удаляя истёкшие. Вызывается под s.mu.
func (s *MemoryStore) isUserOnlineLocked(userID string, now time.Time) bool {
	conns, ok := s.leases[userID]
	if !ok {
		return false
	}
	hasActive := false
	for connID, expiresAt := range conns {
		if !expiresAt.After(now) {
			delete(conns, connID)
		} else {
			hasActive = true
		}
	}
	if len(conns) == 0 {
		delete(s.leases, userID)
	}
	return hasActive
}

// OnlineUsers возвращает из userIDs те, у которых есть хотя бы один
// неистёкший lease; истёкшие lease вычищаются при чтении.
// Порядок результата совпадает с порядком userIDs.
func (s *MemoryStore) OnlineUsers(ctx context.Context, userIDs []string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	res := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		if s.isUserOnlineLocked(userID, now) {
			res = append(res, userID)
		}
	}
	return res, nil
}
