ALTER TABLE messages.messages
    ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES messages.messages(id),
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS messages_messages_chat_created_idx
    ON messages.messages(chat_id, created_at DESC);

