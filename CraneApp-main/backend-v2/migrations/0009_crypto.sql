CREATE SCHEMA IF NOT EXISTS crypto;

-- E2E encryption keys
CREATE TABLE IF NOT EXISTS crypto.user_public_keys (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_key  TEXT NOT NULL,
    key_id      TEXT NOT NULL,
    pq_public_key TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-chat encrypted session keys (wrapped for each member)
CREATE TABLE IF NOT EXISTS crypto.chat_encryption_keys (
    chat_id       UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    encrypted_key TEXT NOT NULL,
    sender_key_id TEXT,
    pq_ciphertext TEXT,
    key_epoch     INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

-- MLS KeyPackage pool (single-use, consumed on fetch)
CREATE TABLE IF NOT EXISTS crypto.user_mls_keypackages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    keypackage_id   TEXT NOT NULL,
    keypackage_bytes TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS crypto_mls_kp_user_idx ON crypto.user_mls_keypackages(user_id, created_at);

-- MLS group ratchet state
CREATE TABLE IF NOT EXISTS crypto.group_mls_state (
    chat_id        UUID PRIMARY KEY REFERENCES chats.chats(id) ON DELETE CASCADE,
    epoch          BIGINT NOT NULL DEFAULT 0,
    tree_structure TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MLS commit history
CREATE TABLE IF NOT EXISTS crypto.group_mls_commits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id      UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    epoch        BIGINT NOT NULL,
    sender_id    UUID NOT NULL REFERENCES auth.users(id),
    commit_bytes TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS crypto_mls_commits_chat_idx ON crypto.group_mls_commits(chat_id, epoch);

-- MLS Welcome messages for new members
CREATE TABLE IF NOT EXISTS crypto.group_mls_welcome (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id      UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_id    UUID NOT NULL REFERENCES auth.users(id),
    epoch        BIGINT NOT NULL,
    welcome_bytes TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chat_id, recipient_id)
);

-- Crypto audit log
CREATE TABLE IF NOT EXISTS crypto.audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    chat_id    UUID REFERENCES chats.chats(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details    JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS crypto_audit_log_user_idx ON crypto.audit_log(user_id, created_at);
