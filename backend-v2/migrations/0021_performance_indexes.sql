-- Migration: Performance Optimization - Add Missing Indexes for Chats and Messages
-- This migration adds critical indexes to improve query performance for chat and message operations

-- 1. Chat member queries need faster lookups
-- Existing: chats.members(user_id)
-- New: Combined index for user + chat lookups
CREATE INDEX IF NOT EXISTS chats_members_user_chat_idx ON chats.members(user_id, chat_id);
CREATE INDEX IF NOT EXISTS chats_members_chat_idx ON chats.members(chat_id);

-- 2. Message queries need optimized sorting and filtering
-- Existing: messages.messages(chat_id, created_at DESC)
-- New: Partial index for non-deleted messages (common filter)
CREATE INDEX IF NOT EXISTS messages_chat_not_deleted_idx ON messages.messages(chat_id, created_at DESC) 
WHERE deleted_at IS NULL;

-- New: Index for sender lookups in messages
CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages.messages(sender_id, created_at DESC);

-- New: Index for deleted_at filtering (used in is_deleted checks)
CREATE INDEX IF NOT EXISTS messages_deleted_at_idx ON messages.messages(deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. Unread message counting needs faster lookups
-- New: Index for efficient unread count calculation
CREATE INDEX IF NOT EXISTS messages_chat_sender_deleted_idx ON messages.messages(chat_id, sender_id, deleted_at);

-- 4. Chat settings need optimized queries
-- Existing: chats.user_chat_settings(user_id, is_archived)
-- New: Add indexes for last_read_at filtering
CREATE INDEX IF NOT EXISTS chats_user_settings_user_chat_idx ON chats.user_chat_settings(user_id, chat_id);
CREATE INDEX IF NOT EXISTS chats_user_settings_read_idx ON chats.user_chat_settings(user_id, last_read_at DESC);

-- 5. Online status check needs faster user_sessions lookup
-- Existing: public.user_sessions(user_id)
-- New: Composite index for online status checks
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx ON public.user_sessions(user_id, last_active DESC);

-- 6. Chat ban queries need faster lookups
-- New: Index for ban checks
CREATE INDEX IF NOT EXISTS chats_bans_chat_user_idx ON chats.bans(chat_id, user_id);
CREATE INDEX IF NOT EXISTS chats_bans_not_expired_idx ON chats.bans(chat_id, user_id, banned_until) 
WHERE banned_until IS NULL OR banned_until > NOW();

-- 7. Favorite messages lookup
-- Optimization for favorite operations (if table exists)
CREATE INDEX IF NOT EXISTS messages_favorites_message_user_idx ON messages.favorites(message_id, user_id);

-- 8. Reactions lookup optimization
-- Existing: messages.reactions(message_id)
-- New: Composite index for existence checks
CREATE INDEX IF NOT EXISTS messages_reactions_message_user_emoji_idx ON messages.reactions(message_id, user_id, emoji);

-- 9. Pinned messages need faster lookups per chat
-- Existing: messages.pins(chat_id)
-- New: Composite index with message_id for efficient lookups
CREATE INDEX IF NOT EXISTS messages_pins_chat_message_idx ON messages.pins(chat_id, message_id);

-- 10. User profile lookups (for name display in messages)
-- New: Index for profile lookups by user_id
CREATE INDEX IF NOT EXISTS users_profiles_user_idx ON users.profiles(user_id);

-- 11. Blocked users check (for private chat creation)
-- Existing: users.blocked_users(blocked_user_id)
-- New: Add composite index for blocking checks
CREATE INDEX IF NOT EXISTS users_blocked_users_composite_idx ON users.blocked_users(user_id, blocked_user_id);

-- 12. Auth users disabled check (for chat operations)
-- New: Index for enabled users lookup
CREATE INDEX IF NOT EXISTS auth_users_disabled_idx ON auth.users(disabled_at) WHERE disabled_at IS NULL;

-- 13. Covering indexes for common query patterns
-- This allows PostgreSQL to satisfy queries using only the index (index-only scans)
CREATE INDEX IF NOT EXISTS messages_messages_covering_idx ON messages.messages(chat_id, created_at DESC, sender_id, content, deleted_at)
WHERE deleted_at IS NULL;

-- 14. Partial index for archived chats (small subset of data)
CREATE INDEX IF NOT EXISTS chats_user_settings_archived_partial_idx ON chats.user_chat_settings(user_id, chat_id)
WHERE is_archived = TRUE;

-- 15. Composite index for recent messages lookup
CREATE INDEX IF NOT EXISTS messages_chat_recent_idx ON messages.messages(chat_id, deleted_at, created_at DESC);

-- Analyze all tables to update statistics after index creation
ANALYZE chats.chats;
ANALYZE chats.members;
ANALYZE chats.bans;
ANALYZE chats.user_chat_settings;
ANALYZE messages.messages;
ANALYZE messages.reactions;
ANALYZE messages.pins;
ANALYZE messages.favorites;
ANALYZE auth.users;
ANALYZE users.profiles;
ANALYZE users.blocked_users;
ANALYZE public.user_sessions;
