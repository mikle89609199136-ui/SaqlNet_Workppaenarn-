-- End-to-end key backup (#740).
--
-- The client encrypts everything before upload: the server stores opaque
-- blobs and never sees the master key, the cloud password or any chat key.

CREATE TABLE IF NOT EXISTS crypto.key_backups (
    user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    version        BIGINT NOT NULL,
    format_version INTEGER NOT NULL,
    identity       TEXT NOT NULL,
    slots          JSONB NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per chat key epoch. Rows are immutable: an epoch key never changes,
-- so a second upload of the same epoch is ignored rather than overwritten.
CREATE TABLE IF NOT EXISTS crypto.chat_key_backups (
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chat_id       UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    key_epoch     INTEGER NOT NULL CHECK (key_epoch >= 1),
    encrypted_key TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, chat_id, key_epoch)
);
