// Package presence определяет единый источник online-состояния пользователей.
// WSServer только записывает lifecycle соединений, ChatService — читает.
package presence

import (
	"context"
	"time"
)

const (
	// HeartbeatInterval — интервал heartbeat от клиента.
	HeartbeatInterval = 25 * time.Second
	// LeaseTTL — время жизни lease соединения без heartbeat.
	LeaseTTL = 75 * time.Second
)

// Store хранит online-состояние как набор lease: одна на WebSocket-соединение.
type Store interface {
	Connect(ctx context.Context, userID, connectionID string) error
	Heartbeat(ctx context.Context, userID, connectionID string) error
	Disconnect(ctx context.Context, userID, connectionID string) error
	OnlineUsers(ctx context.Context, userIDs []string) ([]string, error)
}
