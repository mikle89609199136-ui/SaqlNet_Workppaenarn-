-- ============================================================
-- Migration: Change reaction logic
-- Goal: switch from "multiple reactions per user on a message"
--       to "only one reaction per user per message".
-- Actions: remove duplicates, change the unique constraint.
-- ============================================================

BEGIN; -- Start transaction for atomicity.

-- -----------------------------------------------------------------
-- Step 1. Remove duplicate records
-- -----------------------------------------------------------------
-- Previously, a user could put several different emojis on one message.
-- Now we need to keep for each (message_id, user_id) pair only one record —
-- the most recent one (with the greatest created_at).
--
-- We use the window function ROW_NUMBER().
-- It numbers rows within each group (PARTITION BY message_id, user_id)
-- in descending order of created_at (ORDER BY created_at DESC).
-- The first row in the group (rn = 1) is the latest reaction.
-- All rows with rn > 1 are older duplicates and will be deleted.
--
-- When table will be very large, it is recommended to create an index:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reactions_cover
--       ON messages.reactions (message_id, user_id, created_at DESC);
-- This will speed up the window function and deletion.

WITH ranked AS (
    SELECT
        id,   -- record identifier to delete specific rows later
        ROW_NUMBER() OVER (
            PARTITION BY message_id, user_id   -- group by (message, user)
            ORDER BY created_at DESC           -- sort within group: newest first
        ) AS rn                                -- row number within the group
    FROM messages.reactions
)
DELETE FROM messages.reactions
WHERE id IN (
    SELECT id
    FROM ranked
    WHERE rn > 1   -- keep only the first (latest) row; delete the rest
);

-- -----------------------------------------------------------------
-- Step 2. Drop the old unique constraint
-- -----------------------------------------------------------------
-- The old constraint enforced uniqueness on (message_id, user_id, emoji)
-- – that is, a user could put the same emoji only once, but could have
-- several different ones. We no longer need this constraint.
-- IF EXISTS ensures the migration does not fail if the constraint
-- has already been dropped (e.g., on a re-run).

ALTER TABLE messages.reactions
    DROP CONSTRAINT IF EXISTS reactions_message_id_user_id_emoji_key;

-- -----------------------------------------------------------------
-- Step 3. Add the new unique constraint only if it does not exist
-- -----------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reactions_message_id_user_id_key'
          AND conrelid = 'messages.reactions'::regclass
    ) THEN
        ALTER TABLE messages.reactions
            ADD CONSTRAINT reactions_message_id_user_id_key
            UNIQUE (message_id, user_id);
    END IF;
END $$;

-- -----------------------------------------------------------------
-- Commit the transaction
-- -----------------------------------------------------------------
-- All changes (deleting duplicates, changing constraints) become
-- permanent only after COMMIT. If an error occurs at any earlier step,
-- the entire block will be rolled back (ROLLBACK) automatically.
COMMIT;

-- Additional note:
--
-- Recommended to create a backup for this table before migration.
--
-- Please be aware that duplicates removed in Step 1 CANNOT BE RESTORED!.
-- Rolling back the structure is possible, but the data will already
-- be in the new state (without duplicates). For a full data rollback,
-- you would need to restore the table from a backup.