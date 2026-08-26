-- Add muted_at to chats.members to distinguish "muted permanently"
-- (muted_at set, muted_until NULL) from "not muted" (both NULL).

ALTER TABLE chats.members
    ADD COLUMN IF NOT EXISTS muted_at TIMESTAMPTZ NULL;

-- Backfill rows muted by the old "+365 days" hack so the new CHECK passes.
UPDATE chats.members
SET muted_at = NOW()
WHERE muted_at IS NULL AND muted_until IS NOT NULL;

-- Invariant: muted_until without muted_at is an illegal state.
--
-- ADD CONSTRAINT не понимает IF NOT EXISTS, поэтому ограничение сначала
-- снимается: локальный стек прогоняет все миграции заново при каждом
-- запуске, и без этого повторный старт обрывался здесь, а вместе с ним
-- не поднимались и все сервисы, ждущие мигратора.
ALTER TABLE chats.members
    DROP CONSTRAINT IF EXISTS chats_members_mute_state_check;

ALTER TABLE chats.members
    ADD CONSTRAINT chats_members_mute_state_check
    CHECK (
        muted_at IS NOT NULL
        OR muted_until IS NULL
    );
