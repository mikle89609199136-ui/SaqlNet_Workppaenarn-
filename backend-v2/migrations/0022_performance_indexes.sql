-- Performance indexes for chat/message hot paths under the current schema.
-- Safe to re-run: all statements use IF NOT EXISTS.

-- chats.members is the hot path for user->chat membership and chat->user membership checks.
CREATE INDEX IF NOT EXISTS chats_members_user_chat_idx
    ON chats.members (user_id, chat_id);

CREATE INDEX IF NOT EXISTS chats_members_chat_user_idx
    ON chats.members (chat_id, user_id);

-- chats.user_chat_settings is used for pinned/archived/unread lookups.
CREATE INDEX IF NOT EXISTS chats_user_settings_user_chat_idx
    ON chats.user_chat_settings (user_id, chat_id);

CREATE INDEX IF NOT EXISTS chats_user_settings_user_last_read_idx
    ON chats.user_chat_settings (user_id, last_read_at DESC);

-- Common message listing query: get latest non-deleted messages for a chat.
CREATE INDEX IF NOT EXISTS messages_chat_not_deleted_idx
    ON messages.messages (chat_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- Unread/read-state and sender-based lookups.
CREATE INDEX IF NOT EXISTS messages_chat_sender_deleted_idx
    ON messages.messages (chat_id, sender_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_sender_created_idx
    ON messages.messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_deleted_at_idx
    ON messages.messages (deleted_at)
    WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx
    ON messages.messages (reply_to)
    WHERE reply_to IS NOT NULL;

-- Reactions / pins / favorites are common in message threads.
CREATE INDEX IF NOT EXISTS messages_reactions_message_user_emoji_idx
    ON messages.reactions (message_id, user_id, emoji);

CREATE INDEX IF NOT EXISTS messages_pins_chat_message_idx
    ON messages.pins (chat_id, message_id);

CREATE INDEX IF NOT EXISTS messages_favorites_user_message_idx
    ON messages.favorites (user_id, message_id);

CREATE INDEX IF NOT EXISTS messages_favorites_message_user_idx
    ON messages.favorites (message_id, user_id);

-- Calls and participant lookups.
CREATE INDEX IF NOT EXISTS calls_participants_user_room_idx
    ON calls.participants (user_id, room_id);

CREATE INDEX IF NOT EXISTS calls_rooms_chat_created_idx
    ON calls.rooms (chat_id, created_at DESC);

-- Online status and current login tracking.
CREATE INDEX IF NOT EXISTS user_sessions_user_active_current_idx
    ON public.user_sessions (user_id, is_current, last_active DESC);

-- Block and profile lookups often happen during chat creation and user display.
CREATE INDEX IF NOT EXISTS users_blocked_users_user_blocked_idx
    ON users.blocked_users (user_id, blocked_user_id);

CREATE INDEX IF NOT EXISTS users_profiles_user_idx
    ON users.profiles (user_id);

-- Refresh stats after building indexes.
ANALYZE chats.members;
ANALYZE chats.user_chat_settings;
ANALYZE messages.messages;
ANALYZE messages.reactions;
ANALYZE messages.pins;
ANALYZE messages.favorites;
ANALYZE calls.participants;
ANALYZE calls.rooms;
ANALYZE public.user_sessions;
ANALYZE users.blocked_users;
ANALYZE users.profiles;
