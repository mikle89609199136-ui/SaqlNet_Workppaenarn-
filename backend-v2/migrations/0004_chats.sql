CREATE TABLE IF NOT EXISTS chats.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('private', 'group', 'channel')),
    title VARCHAR(128) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    owner_id UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats.members (
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    permissions JSONB NOT NULL DEFAULT '{}',
    muted_until TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS chats.bans (
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    banned_by UUID REFERENCES auth.users(id),
    reason TEXT NOT NULL DEFAULT '',
    banned_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS chats.user_chat_settings (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at TIMESTAMPTZ,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    last_read_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS messages.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id),
    content TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'text',
    reply_to UUID REFERENCES messages.messages(id),
    content_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    forwarded_message_id UUID,
    forwarded_sender_id UUID,
    forwarded_sender_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    media_url TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    size_bytes BIGINT NOT NULL DEFAULT 0
        CHECK (size_bytes >= 0 AND size_bytes <= 104857600),
    media_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    media_encryption JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, position)
);

CREATE INDEX IF NOT EXISTS chats_chats_type_idx ON chats.chats(type);
CREATE INDEX IF NOT EXISTS chats_members_user_idx ON chats.members(user_id);
CREATE INDEX IF NOT EXISTS chats_user_settings_archived_idx ON chats.user_chat_settings(user_id, is_archived);
CREATE INDEX IF NOT EXISTS messages_messages_chat_created_idx ON messages.messages(chat_id, created_at DESC);
