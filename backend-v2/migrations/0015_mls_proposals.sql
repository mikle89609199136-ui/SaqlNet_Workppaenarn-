-- backend-v2/migrations/0014_mls_proposals.sql

CREATE TABLE IF NOT EXISTS crypto.group_mls_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id),
    proposal_type VARCHAR NOT NULL, -- 'ADD', 'UPDATE', 'REMOVE'
    proposal_bytes TEXT NOT NULL,
    epoch BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crypto_mls_proposals_chat_idx ON crypto.group_mls_proposals(chat_id, epoch);
