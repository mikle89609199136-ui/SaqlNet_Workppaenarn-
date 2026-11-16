-- Export user messages index
-- For query: SELECT id, chat_id, content, type, created_at, updated_at
-- FROM messages.messages WHERE sender_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC

CREATE INDEX IF NOT EXISTS messages_messages_sender_created_idx ON messages.messages (sender_id, created_at) WHERE deleted_at IS NULL;