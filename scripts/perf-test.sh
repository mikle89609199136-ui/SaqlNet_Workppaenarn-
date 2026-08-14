#!/bin/bash
# Performance Testing Script for Chat and Message Queries
# Measures query execution times and analyzes performance bottlenecks

set -e

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-craneapp}"
DB_USER="${DB_USER:-postgres}"
RESULTS_FILE="perf_results_$(date +%Y%m%d_%H%M%S).txt"
EXPLAIN_FILE="explain_results_$(date +%Y%m%d_%H%M%S).txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "Chat & Message Performance Testing Script"
echo "============================================"
echo "Database: $DB_NAME"
echo "Results file: $RESULTS_FILE"
echo "Explain file: $EXPLAIN_FILE"
echo ""

# Function to run query and measure time
run_query_with_time() {
    local query_name=$1
    local query=$2
    local user_id=$3
    
    echo "[$(date '+%H:%M:%S')] Testing: $query_name"
    
    # Run query 5 times and average
    local total_time=0
    local min_time=999999
    local max_time=0
    
    for i in {1..5}; do
        local start=$(date +%s%N)
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$query" > /dev/null 2>&1
        local end=$(date +%s%N)
        
        local elapsed=$((($end - $start) / 1000000))  # Convert to ms
        total_time=$((total_time + elapsed))
        
        if [ $elapsed -lt $min_time ]; then
            min_time=$elapsed
        fi
        if [ $elapsed -gt $max_time ]; then
            max_time=$elapsed
        fi
    done
    
    local avg_time=$((total_time / 5))
    
    echo "$query_name: AVG=${avg_time}ms, MIN=${min_time}ms, MAX=${max_time}ms" | tee -a "$RESULTS_FILE"
    
    # Store in summary for later analysis
    echo "$query_name;$avg_time;$min_time;$max_time" >> "${RESULTS_FILE}.csv"
}

# Function to run EXPLAIN ANALYZE
run_explain_analyze() {
    local query_name=$1
    local query=$2
    
    echo "" >> "$EXPLAIN_FILE"
    echo "===========================================" >> "$EXPLAIN_FILE"
    echo "Query: $query_name" >> "$EXPLAIN_FILE"
    echo "===========================================" >> "$EXPLAIN_FILE"
    
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "EXPLAIN (ANALYZE, BUFFERS) $query" >> "$EXPLAIN_FILE" 2>&1
}

# Get a random test user
TEST_USER=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM auth.users WHERE username LIKE 'testuser_%' LIMIT 1")
if [ -z "$TEST_USER" ]; then
    echo -e "${RED}Error: No test users found. Run perf-test-data.sql first.${NC}"
    exit 1
fi

echo -e "${GREEN}Using test user: $TEST_USER${NC}"
echo ""

# Create CSV header
echo "Query;Avg(ms);Min(ms);Max(ms)" > "${RESULTS_FILE}.csv"

echo "============================================"
echo "1. CHAT LIST QUERY (Core Operation)"
echo "============================================"
cat > /tmp/query_list_chats.sql << EOF
SELECT c.id::text, c.type,
       CASE WHEN c.type = 'private' THEN
         COALESCE(
           NULLIF(TRIM(COALESCE(peer.first_name,'') ||
             CASE WHEN COALESCE(peer.last_name,'') != '' THEN ' ' || peer.last_name ELSE '' END), ''),
           peer.display_username
         )
       ELSE c.title END,
       c.description,
       CASE WHEN c.type = 'private' THEN COALESCE(peer.avatar_url, '') ELSE COALESCE(c.avatar_url, '') END,
       c.owner_id::text, cm.role,
       COALESCE(cs.is_pinned, FALSE), COALESCE(cs.is_archived, FALSE),
       COALESCE(cs.last_read_at::text, ''), c.created_at::text, c.updated_at::text,
       COUNT(DISTINCT cm_all.user_id)::int, COALESCE(MAX(m.created_at)::text, ''),
       COALESCE(peer.peer_id, ''),
       COALESCE(peer.is_online, FALSE), COALESCE(peer.last_seen, ''),
       COUNT(DISTINCT m.id) FILTER (
         WHERE (cs.last_read_at IS NULL OR m.created_at > cs.last_read_at)
           AND (m.sender_id IS NULL OR m.sender_id <> '$TEST_USER')
       )::int,
       COALESCE(lm.sender_id::text, ''), lm.content, lm.type, COALESCE(lm_up.first_name, lm_au.first_name, lm_au.username, '')
FROM chats.chats c
JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = '$TEST_USER'
LEFT JOIN chats.user_chat_settings cs ON cs.chat_id = c.id AND cs.user_id = '$TEST_USER'
LEFT JOIN chats.members cm_all ON cm_all.chat_id = c.id
LEFT JOIN messages.messages m ON m.chat_id = c.id AND m.deleted_at IS NULL
LEFT JOIN LATERAL (
  SELECT au.id::text AS peer_id,
         COALESCE(up.first_name, au.first_name, '') AS first_name,
         COALESCE(up.last_name,  au.last_name,  '') AS last_name,
         COALESCE(up.avatar_url, '') AS avatar_url,
         au.username || '.' || au.username_discriminator::text AS display_username,
         EXISTS(SELECT 1 FROM public.user_sessions us WHERE us.user_id = au.id AND us.last_active > NOW() - INTERVAL '5 minutes') AS is_online,
         COALESCE((SELECT MAX(us.last_active)::text FROM public.user_sessions us WHERE us.user_id = au.id), '') AS last_seen
  FROM chats.members pm
  JOIN auth.users au ON au.id = pm.user_id
  LEFT JOIN users.profiles up ON up.user_id = pm.user_id
  WHERE pm.chat_id = c.id AND pm.user_id != '$TEST_USER'
  LIMIT 1
) peer ON c.type = 'private'
LEFT JOIN LATERAL (
  SELECT sender_id, content, type
  FROM messages.messages
  WHERE chat_id = c.id AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
) lm ON TRUE
LEFT JOIN auth.users lm_au ON lm_au.id = lm.sender_id
LEFT JOIN users.profiles lm_up ON lm_up.user_id = lm.sender_id
WHERE COALESCE(cs.is_archived, FALSE) = FALSE
GROUP BY c.id, cm.role, cs.is_pinned, cs.is_archived, cs.last_read_at,
         peer.peer_id, peer.first_name, peer.last_name, peer.avatar_url, peer.display_username,
         peer.is_online, peer.last_seen,
         lm.sender_id, lm.content, lm.type, lm_up.first_name, lm_au.first_name, lm_au.username
ORDER BY COALESCE(cs.is_pinned, FALSE) DESC, MAX(m.created_at) DESC NULLS LAST, c.updated_at DESC;
EOF

run_query_with_time "List Chats" "$(cat /tmp/query_list_chats.sql)" "$TEST_USER"
run_explain_analyze "List Chats" "$(cat /tmp/query_list_chats.sql)"

# Get a random chat for message tests
TEST_CHAT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM chats.chats WHERE id IN (SELECT chat_id FROM chats.members WHERE user_id = '$TEST_USER') LIMIT 1")

if [ -n "$TEST_CHAT" ]; then
    echo ""
    echo "============================================"
    echo "2. LIST MESSAGES QUERY (Core Operation)"
    echo "============================================"
    
    cat > /tmp/query_list_messages.sql << EOF
SELECT *
FROM (
    SELECT m.id::text, m.chat_id::text, m.sender_id::text,
           COALESCE(up.first_name, au.first_name, au.username, ''), COALESCE(up.avatar_url, ''),
           m.content, m.type, m.reply_to::text, m.metadata,
           (p.message_id IS NOT NULL), m.updated_at > m.created_at,
           m.created_at::text, m.updated_at::text, m.deleted_at::text
    FROM messages.messages m
    LEFT JOIN auth.users au ON au.id = m.sender_id
    LEFT JOIN users.profiles up ON up.user_id = m.sender_id
    LEFT JOIN messages.pins p ON p.message_id = m.id
    WHERE m.chat_id = '$TEST_CHAT' AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT 50 OFFSET 0
) recent_messages
ORDER BY created_at ASC;
EOF

    run_query_with_time "List Messages (50)" "$(cat /tmp/query_list_messages.sql)" "$TEST_USER"
    run_explain_analyze "List Messages (50)" "$(cat /tmp/query_list_messages.sql)"
    
    echo ""
    echo "============================================"
    echo "3. IS MEMBER CHECK (Frequent Operation)"
    echo "============================================"
    
    cat > /tmp/query_is_member.sql << EOF
SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = '$TEST_USER' AND chat_id = '$TEST_CHAT');
EOF

    run_query_with_time "Is Member Check" "$(cat /tmp/query_is_member.sql)" "$TEST_USER"
    run_explain_analyze "Is Member Check" "$(cat /tmp/query_is_member.sql)"
    
    echo ""
    echo "============================================"
    echo "4. GET MESSAGE BY ID (Frequent Operation)"
    echo "============================================"
    
    TEST_MSG=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM messages.messages WHERE chat_id = '$TEST_CHAT' LIMIT 1")
    
    if [ -n "$TEST_MSG" ]; then
        cat > /tmp/query_get_message.sql << EOF
SELECT chat_id::text FROM messages.messages WHERE id = '$TEST_MSG' AND deleted_at IS NULL;
EOF

        run_query_with_time "Get Message By ID" "$(cat /tmp/query_get_message.sql)" "$TEST_USER"
        run_explain_analyze "Get Message By ID" "$(cat /tmp/query_get_message.sql)"
    fi
fi

echo ""
echo "============================================"
echo "5. SEARCH MESSAGES (Heavy Operation)"
echo "============================================"

TEST_SEARCH=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id, chat_id FROM messages.messages LIMIT 1")
if [ -n "$TEST_SEARCH" ]; then
    cat > /tmp/query_search.sql << EOF
SELECT m.id::text, m.chat_id::text, m.sender_id::text, m.content, m.created_at::text
FROM messages.messages m
WHERE m.sender_id = '$TEST_USER' OR m.chat_id IN (
    SELECT chat_id FROM chats.members WHERE user_id = '$TEST_USER'
)
AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', 'test')
ORDER BY m.created_at DESC
LIMIT 20;
EOF

    run_query_with_time "Search Messages" "$(cat /tmp/query_search.sql)" "$TEST_USER"
    run_explain_analyze "Search Messages" "$(cat /tmp/query_search.sql)"
fi

echo ""
echo "============================================"
echo "6. INDEX USAGE ANALYSIS"
echo "============================================"

cat > /tmp/index_analysis.sql << EOF
-- Check which indexes are being used
SELECT 
    schemaname, 
    tablename, 
    indexname,
    idx_scan as "Scans",
    idx_tup_read as "Tuples Read",
    idx_tup_fetch as "Tuples Fetched"
FROM pg_stat_user_indexes
WHERE schemaname IN ('chats', 'messages')
ORDER BY idx_scan DESC;

-- Check for missing indexes (using pg_stat_user_tables)
SELECT 
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    CASE 
        WHEN seq_scan > 1000 THEN 'WARNING: High sequential scans'
        ELSE 'OK'
    END as status
FROM pg_stat_user_tables
WHERE schemaname IN ('chats', 'messages', 'users', 'public')
ORDER BY seq_scan DESC;
EOF

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$(cat /tmp/index_analysis.sql)" | tee -a "$RESULTS_FILE"

echo ""
echo "============================================"
echo "Test Results Summary"
echo "============================================"
echo "Results saved to: $RESULTS_FILE"
echo "EXPLAIN results saved to: $EXPLAIN_FILE"
echo ""
echo "CSV Summary:"
cat "${RESULTS_FILE}.csv"
echo ""
echo -e "${GREEN}Performance testing completed!${NC}"
