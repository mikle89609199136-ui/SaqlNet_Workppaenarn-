package presence

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisStore — реализация Store поверх Redis Sorted Set.
// Ключ: presence:user:{userID}; member = connectionID, score = expiresAt (Unix nano).
// Пользователь online, пока в его множестве есть хотя бы один member со score > now.
type RedisStore struct {
	client *redis.Client
}

// NewRedisStore создаёт Redis-реализацию Store поверх переданного клиента.
func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
}

// redisKey возвращает ключ Sorted Set с lease соединений пользователя.
func redisKey(userID string) string {
	return "presence:user:" + userID
}

// Connect ставит lease соединению: score = now + LeaseTTL.
func (s *RedisStore) Connect(ctx context.Context, userID, connectionID string) error {
	return s.client.ZAdd(ctx, redisKey(userID), redis.Z{
		Member: connectionID,
		Score:  float64(time.Now().Add(LeaseTTL).UnixNano()),
	}).Err()
}

// Heartbeat продлевает lease конкретного соединения на LeaseTTL.
// Несуществующий lease не создаётся (ZAddXX обновляет только существующий member).
func (s *RedisStore) Heartbeat(ctx context.Context, userID, connectionID string) error {
	return s.client.ZAddXX(ctx, redisKey(userID), redis.Z{
		Member: connectionID,
		Score:  float64(time.Now().Add(LeaseTTL).UnixNano()),
	}).Err()
}

// Disconnect удаляет lease конкретного соединения; пропущенный disconnect
// компенсируется истечением TTL (score уходит в прошлое).
func (s *RedisStore) Disconnect(ctx context.Context, userID, connectionID string) error {
	return s.client.ZRem(ctx, redisKey(userID), connectionID).Err()
}

// pendingPresence связывает идентификатор пользователя с отложенной командой выборки lease.
type pendingPresence struct {
	userID string
	cmd    *redis.StringSliceCmd
}

// queuePresenceQueries добавляет в pipeline команды очистки истёкших lease и выборки активных.
func queuePresenceQueries(ctx context.Context, pipe redis.Pipeliner, userIDs []string, now string) []pendingPresence {
	cmds := make([]pendingPresence, 0, len(userIDs))
	for _, id := range userIDs {
		key := redisKey(id)
		// Чистка истёкших lease при чтении: score <= now удаляются.
		pipe.ZRemRangeByScore(ctx, key, "-inf", now)
		// Остаются только живые lease: score строго больше now.
		cmd := pipe.ZRangeByScore(ctx, key, &redis.ZRangeBy{
			Min: "(" + now,
			Max: "+inf",
		})
		cmds = append(cmds, pendingPresence{userID: id, cmd: cmd})
	}
	return cmds
}

// collectOnlineUsers фильтрует пользователей, у которых остался хотя бы один активный lease.
func collectOnlineUsers(cmds []pendingPresence) []string {
	online := make([]string, 0, len(cmds))
	for _, p := range cmds {
		if len(p.cmd.Val()) > 0 {
			online = append(online, p.userID)
		}
	}
	return online
}

// OnlineUsers возвращает UUID из userIDs, у которых есть неистёкшая lease,
// в порядке входного среза. Заодно чистит истёкшие lease (ZREMRANGEBYSCORE).
func (s *RedisStore) OnlineUsers(ctx context.Context, userIDs []string) ([]string, error) {
	if len(userIDs) == 0 {
		return []string{}, nil
	}

	now := strconv.FormatInt(time.Now().UnixNano(), 10)
	pipe := s.client.Pipeline()
	cmds := queuePresenceQueries(ctx, pipe, userIDs, now)

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	return collectOnlineUsers(cmds), nil
}
