# Chat & Message Performance Optimization Guide

This guide walks you through the performance testing and optimization process for chat and message queries.

## Overview

This optimization task includes:
1. **Baseline Performance Testing** - Measure current query speeds
2. **Bottleneck Analysis** - Identify slow queries and missing indexes
3. **Index Creation** - Add optimized indexes
4. **Verification** - Re-test to confirm improvements

## Files Created

### 1. Test Data Generation
**File**: `scripts/perf-test-data.sql`

Generates realistic test data:
- 50 test users
- 100 group chats with 5-15 members each
- 200 private chats
- ~500 messages per chat
- Reactions and pinned messages

**Run once**:
```bash
psql -h localhost -U postgres -d craneapp < scripts/perf-test-data.sql
```

### 2. Performance Testing Script
**File**: `scripts/perf-test.sh`

Runs comprehensive performance tests:
- Measures query execution times (5 runs, avg/min/max)
- Runs EXPLAIN ANALYZE for query plans
- Checks index usage statistics
- Generates detailed reports

**Usage**:
```bash
# Set database connection parameters
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=craneapp
export DB_USER=postgres

# Make executable
chmod +x scripts/perf-test.sh

# Run tests
./scripts/perf-test.sh
```

**Output Files**:
- `perf_results_YYYYMMDD_HHMMSS.txt` - Query timing results
- `perf_results_YYYYMMDD_HHMMSS.txt.csv` - CSV format for analysis
- `explain_results_YYYYMMDD_HHMMSS.txt` - EXPLAIN ANALYZE output

### 3. Performance Analysis Report
**File**: `scripts/performance-analysis.sh`

Generates detailed analysis document:
- Identifies 4 critical bottlenecks
- Lists all missing indexes
- Provides implementation timeline
- Projects performance improvements

**Run**:
```bash
chmod +x scripts/performance-analysis.sh
./scripts/performance-analysis.sh
```

**Output**: `performance_analysis_YYYYMMDD_HHMMSS.md`

### 4. Migration - Performance Indexes
**File**: `backend-v2/migrations/0018_performance_indexes.sql`

Creates 15 optimized indexes:
- Partial indexes for non-deleted messages
- Composite indexes for multi-column lookups
- Covering indexes for index-only scans
- Partial indexes for archived/expired data

**Apply migration**:
```bash
# Using your migration tool
npm run migrate

# Or manually with psql
psql -h localhost -U postgres -d craneapp < backend-v2/migrations/0018_performance_indexes.sql
```

## Step-by-Step Optimization Process

### Step 1: Baseline Performance Testing (BEFORE Optimization)

```bash
# 1. Generate test data
psql -h localhost -U postgres -d craneapp < scripts/perf-test-data.sql

# 2. Run baseline performance tests
export DB_HOST=localhost DB_PORT=5432 DB_NAME=craneapp DB_USER=postgres
chmod +x scripts/perf-test.sh
./scripts/perf-test.sh

# Expected baseline results (without optimized indexes):
# List Chats:        2000-5000ms
# List Messages:     500-1000ms
# Is Member Check:   50-100ms
# Get Message:       30-50ms
```

### Step 2: Analyze Bottlenecks

```bash
# Generate analysis report
chmod +x scripts/performance-analysis.sh
./scripts/performance-analysis.sh

# Read the report to understand:
# - Which queries are slowest
# - Why they're slow
# - What indexes will help
```

### Step 3: Apply Index Migration

```bash
# Apply the migration that creates optimized indexes
psql -h localhost -U postgres -d craneapp < backend-v2/migrations/0018_performance_indexes.sql

# Verify indexes were created
psql -h localhost -U postgres -d craneapp << EOF
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE schemaname IN ('chats', 'messages') 
ORDER BY indexname;
EOF
```

### Step 4: Re-test Performance (AFTER Optimization)

```bash
# Run performance tests again with the same parameters
./scripts/perf-test.sh

# Expected results with optimized indexes:
# List Chats:        300-800ms (60-85% faster)
# List Messages:     50-150ms (70-90% faster)
# Is Member Check:   2-5ms (95% faster)
# Get Message:       2-5ms (95% faster)
```

### Step 5: Compare Results

```bash
# Compare the two results files
diff perf_results_BEFORE.txt.csv perf_results_AFTER.txt.csv

# Create a comparison:
# Query;Before(ms);After(ms);Improvement
# List Chats;3500;400;88.6%
```

## Critical Bottlenecks Explained

### 1. Chat List Query (CRITICAL)
The main query joins to ALL messages in ALL chats to calculate:
- Unread message count
- Last message timestamp
- Member count

**Problem**: Creates huge result set (100 chats × 500 messages = 50,000 rows)

**Solution**: Partial index on `(chat_id, created_at DESC) WHERE deleted_at IS NULL`

### 2. Unread Message Counter (HIGH)
Counts messages where:
- Message is after last read time
- Sender is not current user
- Message is not deleted

**Problem**: No index on (chat_id, sender_id, deleted_at)

**Solution**: Add composite index for faster filtering

### 3. Online Status Check (MEDIUM)
Checks if peer user was active in last 5 minutes

**Problem**: Subquery on user_sessions without proper index on (user_id, last_active)

**Solution**: Composite index for covering scan

### 4. Message Pagination (MEDIUM)
Fetches messages with LIMIT/OFFSET

**Problem**: Large offsets become slow (O(offset) complexity)

**Solution**: Index on (chat_id, created_at) helps, but cursor-based pagination recommended long-term

## Expected Performance Gains

### Phase 1: Indexes Only (No Code Changes)
- **Effort**: 30 minutes
- **Improvement**: 60-85% faster
- **Risk**: Very low

### Phase 2: Query Refactoring (Code Changes)
- **Effort**: 2-4 hours
- **Improvement**: 95-99% faster
- **Risk**: Low (requires testing)

### Phase 3: Cursor Pagination (Advanced)
- **Effort**: 2-3 hours
- **Improvement**: Eliminates O(n) offset cost
- **Risk**: Medium (changes API)

## Monitoring & Maintenance

### Enable Slow Query Log

```bash
# In PostgreSQL configuration
psql -h localhost -U postgres -d craneapp << EOF
ALTER SYSTEM SET log_min_duration_statement = 1000;
ALTER SYSTEM SET log_statement = 'all';
SELECT pg_reload_conf();
EOF

# Then monitor with
tail -f /var/log/postgresql/postgresql.log | grep -v "duration:"
```

### Regular Index Health Checks

```sql
-- Find unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexname NOT LIKE '%constraint%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find missing indexes (high seq_scan)
SELECT schemaname, tablename, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE schemaname IN ('chats', 'messages')
ORDER BY seq_scan DESC;

-- Update table statistics
ANALYZE chats.chats;
ANALYZE messages.messages;
```

## Troubleshooting

### Performance Tests Show No Improvement

1. **Verify indexes were created**:
   ```sql
   SELECT indexname FROM pg_indexes 
   WHERE schemaname = 'messages' 
   AND tablename = 'messages'
   ORDER BY indexname;
   ```

2. **Check if PostgreSQL is using the indexes**:
   ```sql
   EXPLAIN (ANALYZE, BUFFERS) 
   SELECT * FROM messages.messages 
   WHERE chat_id = 'xxx' AND deleted_at IS NULL;
   ```
   Look for "Index Scan" instead of "Seq Scan"

3. **Analyze table statistics**:
   ```sql
   ANALYZE messages.messages;
   ```

4. **Increase work_mem if queries still slow**:
   ```sql
   SET work_mem = '256MB';  -- From default 4MB
   ```

### High Memory Usage During Tests

If tests cause memory issues:
1. Reduce `v_msgs_per_chat` in perf-test-data.sql
2. Run tests one query at a time
3. Increase `work_mem` in PostgreSQL

### Tests Won't Run (Connection Errors)

```bash
# Test database connection
psql -h localhost -U postgres -d craneapp -c "SELECT version();"

# If error, check PostgreSQL is running
# macOS: brew services list
# Linux: sudo systemctl status postgresql
# Docker: docker ps | grep postgres
```

## Migration Details

The migration creates these key indexes:

```sql
-- Critical for chat list performance
CREATE INDEX messages_chat_not_deleted_idx 
ON messages.messages(chat_id, created_at DESC) 
WHERE deleted_at IS NULL;

-- Critical for unread message counting
CREATE INDEX messages_chat_sender_deleted_idx 
ON messages.messages(chat_id, sender_id, deleted_at);

-- Critical for membership checks
CREATE INDEX chats_members_user_chat_idx 
ON chats.members(user_id, chat_id);

-- For online status detection
CREATE INDEX user_sessions_user_active_idx 
ON public.user_sessions(user_id, last_active DESC);

-- Plus 11 more supporting indexes...
```

## Next Steps (Future Optimization)

After indexes are verified:

1. **Materialized View for Message Counts**
   - Cache `chat_message_stats` materialized view
   - Refresh every 5 minutes
   - Eliminates COUNT(DISTINCT) calculation

2. **Cursor-Based Pagination**
   - Replace LIMIT/OFFSET with cursor positions
   - Fix O(n) complexity to O(1)
   - Better for large datasets

3. **Application-Level Caching**
   - Cache user profiles (rarely change)
   - Cache chat metadata (settings)
   - Reduce database round-trips

4. **Query Result Caching**
   - Cache chat list for 30 seconds per user
   - Cache member lists for 5 minutes
   - Use Redis for distributed caching

## References

- [PostgreSQL Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [Index Usage Statistics](https://www.postgresql.org/docs/current/monitoring-stats.html)
- [Query Planning](https://www.postgresql.org/docs/current/using-explain.html)
- [Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)

## Support

For issues or questions:
1. Check the performance analysis report
2. Review EXPLAIN ANALYZE output
3. Check PostgreSQL logs for errors
4. Verify database connection and permissions
