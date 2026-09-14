ALTER TABLE messages.messages
    ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES messages.messages(id),
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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

CREATE INDEX IF NOT EXISTS messages_messages_chat_created_idx
    ON messages.messages(chat_id, created_at DESC);

