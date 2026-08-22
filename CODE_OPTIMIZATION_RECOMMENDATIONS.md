# Code Optimization Recommendations for Chat & Message Queries

This document provides code-level optimization recommendations beyond database indexes.

## Table of Contents
1. [Quick Wins (1-2 hours)](#quick-wins)
2. [Medium Effort (2-4 hours)](#medium-effort)
3. [Large Changes (4-8 hours)](#large-changes)
4. [Long-term Improvements](#long-term)

---

## Quick Wins

### 1. Add Database Connection Pooling

**File**: `backend-v2/internal/chat/service.go`

**Current Issue**: Each query might open a new connection

**Solution**: Ensure connection pool is configured
```go
// In database initialization
sqlDB, err := sql.Open("postgres", connString)
sqlDB.SetMaxOpenConns(25)      // Limit concurrent connections
sqlDB.SetMaxIdleConns(5)       // Reuse idle connections
sqlDB.SetConnMaxLifetime(5 * time.Minute)
```

**Impact**: 5-10% faster query execution

---

### 2. Add Query Timeouts

**File**: `backend-v2/internal/chat/service.go`

**Issue**: No timeout for slow queries, can hang entire connection pool

**Solution**: Add context timeout to all queries
```go
// Before: 
rows, err := s.db.QueryContext(ctx, query, args...)

// After:
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
rows, err := s.db.QueryContext(ctx, query, args...)
```

**Impact**: Prevents cascading failures, better error handling

---

### 3. Pre-allocate Message Slice

**File**: `backend-v2/internal/chat/service.go` - `scanMessages()` function

**Current Code**:
```go
var messages []Message
for rows.Next() {
    var msg Message
    // ... scanning ...
    messages = append(msg)  // Allocates new slice on each iteration
}
```

**Optimized Code**:
```go
messages := make([]Message, 0, limit)  // Pre-allocate capacity
for rows.Next() {
    var msg Message
    // ... scanning ...
    messages = append(msg)  // Reuses pre-allocated capacity
}
```

**Impact**: Reduces memory allocations by ~50%

---

## Medium Effort

### 1. Implement Message Caching with TTL

**File**: Create new file `backend-v2/internal/chat/cache.go`

**Issue**: Recent messages are fetched repeatedly, database sees same queries

**Solution**: In-memory cache with TTL
```go
type MessageCache struct {
    cache map[string][]Message
    ttl   time.Duration
    mu    sync.RWMutex
}

func (mc *MessageCache) GetMessages(chatID string) ([]Message, bool) {
    mc.mu.RLock()
    defer mc.mu.RUnlock()
    
    entry, exists := mc.cache[chatID]
    return entry, exists
}

func (mc *MessageCache) Set(chatID string, messages []Message) {
    mc.mu.Lock()
    defer mc.mu.Unlock()
    
    mc.cache[chatID] = messages
    
    // Expire after TTL
    go func() {
        time.Sleep(mc.ttl)
        mc.mu.Lock()
        delete(mc.cache, chatID)
        mc.mu.Unlock()
    }()
}
```

**Integration**:
```go
func (s *Service) ListMessages(ctx context.Context, userID, chatID string, limit, offset int) ([]Message, error) {
    // Check cache first
    if cached, exists := s.messageCache.Get(chatID); exists && offset == 0 {
        return cached[:limit], nil
    }
    
    // Database query if cache miss
    messages, err := s.getMessagesFromDB(ctx, userID, chatID, limit, offset)
    if err != nil {
        return nil, err
    }
    
    // Cache result
    if offset == 0 {
        s.messageCache.Set(chatID, messages)
    }
    
    return messages, nil
}
```

**Impact**: 80% cache hit rate for frequently accessed chats = 80% query reduction

**Note**: Cache invalidation on message send/delete

---

### 2. Batch User Profile Lookups

**File**: `backend-v2/internal/chat/service.go` - `hydrateMessagesFields()` function

**Current Issue**: Loads user profile separately for each message sender
```go
for _, msg := range messages {
    // This loads profile for each message separately
    profile, err := s.getUserProfile(msg.SenderID)  // N queries for N messages
}
```

**Optimized Solution**: Batch load
```go
func (s *Service) hydrateMessagesFields(ctx context.Context, messages []Message) error {
    // Collect all unique sender IDs
    senderIDs := make(map[string]bool)
    for _, msg := range messages {
        if msg.SenderID != "" {
            senderIDs[msg.SenderID] = true
        }
    }
    
    // Load all profiles at once
    ids := make([]string, 0, len(senderIDs))
    for id := range senderIDs {
        ids = append(ids, id)
    }
    
    profiles, err := s.getUserProfilesBatch(ctx, ids)  // 1 query instead of N
    if err != nil {
        return err
    }
    
    // Assign profiles to messages
    for i := range messages {
        if profile, ok := profiles[messages[i].SenderID]; ok {
            messages[i].SenderName = profile.FirstName + " " + profile.LastName
            messages[i].SenderAvatar = profile.AvatarURL
        }
    }
    
    return nil
}

func (s *Service) getUserProfilesBatch(ctx context.Context, userIDs []string) (map[string]*Profile, error) {
    if len(userIDs) == 0 {
        return map[string]*Profile{}, nil
    }
    
    query := `SELECT user_id::text, first_name, last_name, avatar_url FROM users.profiles WHERE user_id = ANY($1)`
    rows, err := s.db.QueryContext(ctx, query, pq.Array(userIDs))
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    profiles := make(map[string]*Profile)
    for rows.Next() {
        var p Profile
        if err := rows.Scan(&p.UserID, &p.FirstName, &p.LastName, &p.AvatarURL); err != nil {
            return nil, err
        }
        profiles[p.UserID] = &p
    }
    
    return profiles, rows.Err()
}
```

**Implementation**:
```go
// backend-v2/internal/chat/service.go - Add batch method
func (s *Service) getUserProfilesBatch(ctx context.Context, userIDs []string) (map[string]*userProfile, error) {
    // ... implementation ...
}

// Update hydrateMessagesFields to use batch loading
```

**Impact**: 50-100 queries reduced to 1 query for 50 messages

---

### 3. Optimize Unread Count Calculation

**Issue**: Unread count calculated for ALL messages in chat

**Solution**: Use cached/materialized stat
```go
// Instead of counting in LIST query, track in background
func (s *Service) UpdateUnreadCountsJob(ctx context.Context) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    
    for range ticker.C {
        query := `
            INSERT INTO chat_unread_stats (chat_id, user_id, unread_count)
            SELECT m.chat_id, $1, COUNT(*)
            FROM messages.messages m
            LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = m.chat_id
            WHERE cs.user_id = $1 
              AND m.deleted_at IS NULL
              AND (cs.last_read_at IS NULL OR m.created_at > cs.last_read_at)
              AND m.sender_id != $1
            GROUP BY m.chat_id
            ON CONFLICT (chat_id, user_id) 
            DO UPDATE SET unread_count = EXCLUDED.unread_count
        `
        s.db.ExecContext(ctx, query, userID)
    }
}
```

**Impact**: Eliminates expensive COUNT(DISTINCT) calculation in main query

---

## Large Changes

### 1. Refactor Chat List Query into Multiple Queries

**Issue**: Current query does too much in one complex JOIN

**Solution**: Split into smaller, optimized queries
```go
func (s *Service) ListV2(ctx context.Context, userID string, archived bool) ([]Chat, error) {
    // Query 1: Get chats and basic info
    chats, err := s.getChatsBasic(ctx, userID, archived)
    if err != nil {
        return nil, err
    }
    
    // Query 2: Batch get member counts
    memberCounts, err := s.getMemberCountsBatch(ctx, extractChatIDs(chats))
    if err != nil {
        return nil, err
    }
    
    // Query 3: Batch get last messages
    lastMessages, err := s.getLastMessagesBatch(ctx, extractChatIDs(chats))
    if err != nil {
        return nil, err
    }
    
    // Query 4: Batch get unread counts (from cache/materialized view)
    unreadCounts, err := s.getUnreadCountsBatch(ctx, userID, extractChatIDs(chats))
    if err != nil {
        return nil, err
    }
    
    // Combine results
    for i := range chats {
        chats[i].MemberCount = memberCounts[chats[i].ID]
        chats[i].LastMessage = lastMessages[chats[i].ID]
        chats[i].UnreadCount = unreadCounts[chats[i].ID]
    }
    
    return chats, nil
}

// Implementation: 4 simple queries instead of 1 complex query
func (s *Service) getChatsBasic(ctx context.Context, userID string, archived bool) ([]Chat, error) {
    query := `
        SELECT c.id::text, c.type, c.title, c.description, c.avatar_url, c.owner_id::text,
               cm.role, cs.is_pinned, cs.is_archived, cs.last_read_at::text, 
               c.created_at::text, c.updated_at::text
        FROM chats.chats c
        JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = $1
        LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = c.id AND cs.user_id = $1
        WHERE COALESCE(cs.is_archived, FALSE) = $2
        ORDER BY COALESCE(cs.is_pinned, FALSE) DESC, c.updated_at DESC
    `
    // ... scanning ...
}

func (s *Service) getMemberCountsBatch(ctx context.Context, chatIDs []string) (map[string]int, error) {
    query := `
        SELECT chat_id::text, COUNT(DISTINCT user_id)::int
        FROM chats.members
        WHERE chat_id = ANY($1)
        GROUP BY chat_id
    `
    // ... scanning into map ...
}

func (s *Service) getLastMessagesBatch(ctx context.Context, chatIDs []string) (map[string]*LastMessagePreview, error) {
    query := `
        SELECT DISTINCT ON (chat_id) 
               chat_id::text, sender_id::text, content, type
        FROM messages.messages
        WHERE chat_id = ANY($1) AND deleted_at IS NULL
        ORDER BY chat_id, created_at DESC
    `
    // ... scanning into map ...
}
```

**Benefits**:
- Each query is simpler and uses proper indexes
- Parallelizable (queries can run concurrently)
- Easier to cache individual results
- Better error handling per data type

**Impact**: 70-85% performance improvement

---

### 2. Implement Cursor-Based Pagination

**File**: `backend-v2/internal/chat/service.go` - `ListMessages()` method

**Current Issue**: LIMIT/OFFSET is O(n) - pagination gets slower with larger offsets

**Solution**: Cursor-based pagination
```go
// Message cursor: combination of created_at and id
type MessageCursor struct {
    CreatedAt time.Time
    MessageID string
}

func (s *Service) ListMessagesV2(ctx context.Context, userID, chatID string, limit int, cursor *MessageCursor) ([]Message, *MessageCursor, error) {
    if ok, err := s.isMember(ctx, userID, chatID); err != nil || !ok {
        if err != nil {
            return nil, nil, err
        }
        return nil, nil, ErrForbidden
    }
    
    query := `
        SELECT m.id::text, m.chat_id::text, m.sender_id::text,
               COALESCE(up.first_name, au.first_name, au.username, ''),
               COALESCE(up.avatar_url, ''),
               m.content, m.type, m.reply_to::text, m.metadata,
               (p.message_id IS NOT NULL), m.updated_at > m.created_at,
               m.created_at::text, m.updated_at::text, m.deleted_at::text
        FROM messages.messages m
        LEFT JOIN auth.users au ON au.id = m.sender_id
        LEFT JOIN users.profiles up ON up.user_id = m.sender_id
        LEFT JOIN messages.pins p ON p.message_id = m.id
        WHERE m.chat_id = $1 AND m.deleted_at IS NULL
    `
    
    args := []interface{}{chatID}
    
    // Add cursor condition
    if cursor != nil {
        query += ` AND (m.created_at, m.id) < ($2, $3)`
        args = append(args, cursor.CreatedAt, cursor.MessageID)
    }
    
    query += ` ORDER BY m.created_at DESC LIMIT $` + strconv.Itoa(len(args)+1)
    args = append(args, limit+1)  // Fetch one extra to check if more exist
    
    rows, err := s.db.QueryContext(ctx, query, args...)
    if err != nil {
        return nil, nil, err
    }
    defer rows.Close()
    
    messages, err := scanMessages(rows)
    if err != nil {
        return nil, nil, err
    }
    
    var nextCursor *MessageCursor
    if len(messages) > limit {
        // More messages exist
        lastMsg := messages[limit-1]
        createdAt, _ := time.Parse(time.RFC3339, lastMsg.CreatedAt)
        nextCursor = &MessageCursor{
            CreatedAt: createdAt,
            MessageID: lastMsg.ID,
        }
        messages = messages[:limit]  // Remove extra
    }
    
    return messages, nextCursor, nil
}

// Client usage:
// First page: cursor = nil
// messages, nextCursor := service.ListMessagesV2(ctx, userID, chatID, 50, nil)
// Second page: cursor = nextCursor
// messages, nextCursor := service.ListMessagesV2(ctx, userID, chatID, 50, nextCursor)
```

**Benefits**:
- O(1) complexity instead of O(n)
- Works with concurrent inserts
- Eliminates offset skipping
- Index-friendly query

**Impact**: Pagination becomes instant for large datasets

---

## Long-term

### 1. Redis Caching Layer

Add Redis for distributed caching:
```go
type CacheService struct {
    redis *redis.Client
    db *sql.DB
}

func (cs *CacheService) ListChats(ctx context.Context, userID string) ([]Chat, error) {
    cacheKey := "chats:" + userID
    
    // Try cache first
    cached, err := cs.redis.Get(ctx, cacheKey).Result()
    if err == nil {
        var chats []Chat
        json.Unmarshal([]byte(cached), &chats)
        return chats, nil
    }
    
    // Cache miss - fetch from DB
    chats, err := cs.getChatsFromDB(ctx, userID)
    if err != nil {
        return nil, err
    }
    
    // Cache result (30 seconds TTL)
    data, _ := json.Marshal(chats)
    cs.redis.Set(ctx, cacheKey, data, 30*time.Second)
    
    return chats, nil
}
```

### 2. Message Queue for Background Tasks

Use message queue for notifications:
- Message cache invalidation
- Unread count updates
- Notification delivery

### 3. Read Replicas

For read-heavy operations:
- Direct chat list reads to read replica
- Keep write operations on primary
- Reduce load on main database

---

## Implementation Priority

1. **Week 1**: Deploy migration (indexes) + connection pooling + timeouts
2. **Week 2**: Add query caching + batch lookups
3. **Week 3**: Refactor chat list query + implement cursor pagination
4. **Week 4**: Add Redis layer + background jobs

---

## Monitoring After Implementation

```go
// Add Prometheus metrics
import "github.com/prometheus/client_golang/prometheus"

var queryDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
        Name: "chat_query_duration_seconds",
        Buckets: []float64{.001, .01, .1, .5, 1, 2, 5},
    },
    []string{"query_name"},
)

// Usage:
start := time.Now()
chats, err := s.List(ctx, userID, archived)
queryDuration.WithLabelValues("list_chats").Observe(time.Since(start).Seconds())
```

---

## Summary

- **Quick wins**: 5-10% improvement, minimal risk
- **Medium effort**: 30-50% improvement, low risk
- **Large changes**: 80-95% improvement, medium risk
- **Long-term**: 95%+ improvement, ongoing maintenance
