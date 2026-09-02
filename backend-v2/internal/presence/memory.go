package presence

import (
	"context"
	"time"
)

// MemoryStore — in-memory реализация Store для тестов и локальной разработки.
// Хранит lease в виде userID → connectionID → expiresAt; источник времени
// передан извне, чтобы TTL можно было тестировать без sleep.
type MemoryStore struct {
	now    func() time.Time
	leases map[string]map[string]time.Time
}

// NewMemoryStore создаёт MemoryStore с заданным источником текущего времени.
func NewMemoryStore(now func() time.Time) *MemoryStore {
	return &MemoryStore{
		now:    now,
		leases: make(map[string]map[string]time.Time),
	}
}

// Connect добавляет lease соединения со сроком жизни LeaseTTL.
func (s *MemoryStore) Connect(ctx context.Context, userID, connectionID string) error {
	conns, ok := s.leases[userID]
	if !ok {
		conns = make(map[string]time.Time)
		s.leases[userID] = conns
	}
	conns[connectionID] = s.now().Add(LeaseTTL)
	return nil
}

// Heartbeat продлевает lease конкретного соединения на LeaseTTL.
// Несуществующий lease не создаётся.
func (s *MemoryStore) Heartbeat(ctx context.Context, userID, connectionID string) error {
	if conns, ok := s.leases[userID]; ok {
		if expiresAt, ok := conns[connectionID]; ok && expiresAt.After(s.now()) {
			conns[connectionID] = s.now().Add(LeaseTTL)
		}
	}
	return nil
}

// Disconnect удаляет lease соединения; отсутствующий lease — no-op.
func (s *MemoryStore) Disconnect(ctx context.Context, userID, connectionID string) error {
	delete(s.leases[userID], connectionID)
	return nil
}

// OnlineUsers возвращает из userIDs те, у которых есть хотя бы один
// неистёкший lease; истёкшие lease вычищаются при чтении.
// Порядок результата совпадает с порядком userIDs.
func (s *MemoryStore) OnlineUsers(ctx context.Context, userIDs []string) ([]string, error) {
	now := s.now()
	res := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		if conns, ok := s.leases[userID]; ok {
			for connID, expiresAt := range conns {
				if !expiresAt.After(now) {
					delete(conns, connID)
					continue
				}
				res = append(res, userID)
				break
			}
			if len(conns) == 0 {
				delete(s.leases, userID)
			}
		}
	}
	return res, nil
}
