#!/bin/bash
# Quick performance measurement script

DB_HOST="127.0.0.1"
DB_PORT="5433"
DB_USER="postgres"
DB_NAME="craneapp"

export PGPASSWORD="postgres"

# Get a test user
TEST_USER=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM auth.users WHERE username LIKE 'testuser_%' LIMIT 1" 2>/dev/null | tr -d ' ')
TEST_CHAT=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM chats.chats WHERE id IN (SELECT chat_id FROM chats.members WHERE user_id = '$TEST_USER') LIMIT 1" 2>/dev/null | tr -d ' ')

echo "======================================"
echo "PERFORMANCE MEASUREMENT"
echo "======================================"
echo "Test User: $TEST_USER"
echo "Test Chat: $TEST_CHAT"
echo ""

# Test 1: Count existing indexes
echo "=== Current Database Statistics ==="
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOF'
SELECT 
    COUNT(*) as index_count
FROM pg_indexes 
WHERE schemaname IN ('chats', 'messages');

SELECT 
    COUNT(*) as messages,
    COUNT(DISTINCT chat_id) as chats
FROM messages.messages;
EOF

echo ""
echo "=== Query Performance Tests ==="

# Test query 1: Simple chat list (lightweight version)
echo ""
echo "Test 1: Simple chat count query"
time psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF > /dev/null 2>&1
SELECT COUNT(DISTINCT c.id) 
FROM chats.chats c
JOIN chats.members cm ON cm.chat_id = c.id AND cm.user_id = '$TEST_USER';
EOF

# Test query 2: Message list
echo ""
echo "Test 2: Message listing query (LIMIT 50)"
time psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF > /dev/null 2>&1
SELECT m.id, m.sender_id, m.content
FROM messages.messages m
WHERE m.chat_id = '$TEST_CHAT' AND m.deleted_at IS NULL
ORDER BY m.created_at DESC
LIMIT 50;
EOF

# Test query 3: Membership check
echo ""
echo "Test 3: Is member check"
time psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF > /dev/null 2>&1
SELECT EXISTS(SELECT 1 FROM chats.members WHERE user_id = '$TEST_USER' AND chat_id = '$TEST_CHAT');
EOF

# Test query 4: Unread count
echo ""
echo "Test 4: Unread message count"
time psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF > /dev/null 2>&1
SELECT COUNT(*) FROM messages.messages m
WHERE m.chat_id = '$TEST_CHAT' AND m.deleted_at IS NULL AND m.sender_id != '$TEST_USER';
EOF

echo ""
echo "======================================"
echo "Test completed!"
echo "======================================"
