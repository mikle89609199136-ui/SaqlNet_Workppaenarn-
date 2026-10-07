-- Saved Messages is a one-member chat owned by that member. Keep it as a
-- separate type so private-chat peer, presence and blocking semantics never
-- apply to it.
ALTER TABLE chats.chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE chats.chats
    ADD CONSTRAINT chats_type_check
    CHECK (type IN ('private', 'group', 'channel', 'self'));

-- This is also the concurrency guard for lazy creation from several devices.
CREATE UNIQUE INDEX IF NOT EXISTS chats_self_owner_unique
    ON chats.chats(owner_id)
    WHERE type = 'self';
