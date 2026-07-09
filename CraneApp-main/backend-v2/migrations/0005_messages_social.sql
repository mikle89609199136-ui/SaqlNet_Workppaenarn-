-- Message reactions
CREATE TABLE IF NOT EXISTS messages.reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS messages_reactions_message_idx ON messages.reactions(message_id);

-- Pinned messages per chat
CREATE TABLE IF NOT EXISTS messages.pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
    pinned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS messages_pins_chat_idx ON messages.pins(chat_id);

-- Calls
CREATE TABLE IF NOT EXISTS calls.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID REFERENCES chats.chats(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'voice' CHECK (type IN ('voice', 'video')),
    title TEXT NOT NULL DEFAULT '',
    initiator_id UUID REFERENCES auth.users(id),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calls.participants (
    room_id UUID NOT NULL REFERENCES calls.rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    PRIMARY KEY (room_id, user_id)
);

-- Media uploads
CREATE TABLE IF NOT EXISTS media.uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bucket TEXT NOT NULL DEFAULT 'crane-media',
    object_key TEXT NOT NULL,
    filename TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    encryption_key_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_uploads_uploader_idx ON media.uploads(uploader_id);
