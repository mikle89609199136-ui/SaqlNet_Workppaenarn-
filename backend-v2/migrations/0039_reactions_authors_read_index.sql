-- 0039_reactions_authors_read_index.sql
--
-- Index supporting reaction-author reads:
--   GET /api/v2/messages/{messageId}/reactions/users?emoji=...
--
-- Covers:
--   WHERE message_id = $1 AND emoji = $3          -- equality prefix
--   ORDER BY created_at DESC, user_id DESC        -- matches index order
--   (created_at, user_id) < ($4, $5)              -- range scan on cursor
--   COUNT(*) over (message_id, emoji)             -- index-only scan
--
-- IF NOT EXISTS: migrations are re-run on every stack start, so the statement
-- must be idempotent.

CREATE INDEX IF NOT EXISTS idx_reactions_message_emoji_created_user
    ON messages.reactions (message_id, emoji, created_at DESC, user_id DESC);