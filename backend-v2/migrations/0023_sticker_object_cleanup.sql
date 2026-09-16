ALTER TABLE media.sticker_packs
    ADD COLUMN IF NOT EXISTS icon_bucket TEXT,
    ADD COLUMN IF NOT EXISTS icon_object_key TEXT;

ALTER TABLE media.sticker_packs
    DROP CONSTRAINT IF EXISTS sticker_packs_icon_storage_identity_check;

ALTER TABLE media.sticker_packs
    ADD CONSTRAINT sticker_packs_icon_storage_identity_check CHECK (
        (icon_bucket IS NULL AND icon_object_key IS NULL)
        OR
        (icon_bucket IS NOT NULL AND icon_bucket <> '' AND icon_object_key IS NOT NULL AND icon_object_key <> '')
    );

ALTER TABLE media.stickers
    ADD COLUMN IF NOT EXISTS bucket TEXT,
    ADD COLUMN IF NOT EXISTS object_key TEXT;

ALTER TABLE media.stickers
    DROP CONSTRAINT IF EXISTS stickers_storage_identity_check;

ALTER TABLE media.stickers
    ADD CONSTRAINT stickers_storage_identity_check CHECK (
        (bucket IS NULL AND object_key IS NULL)
        OR
        (bucket IS NOT NULL AND bucket <> '' AND object_key IS NOT NULL AND object_key <> '')
    );

CREATE UNIQUE INDEX IF NOT EXISTS sticker_packs_icon_storage_identity_idx
    ON media.sticker_packs(icon_bucket, icon_object_key)
    WHERE icon_bucket IS NOT NULL AND icon_object_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stickers_storage_identity_idx
    ON media.stickers(bucket, object_key)
    WHERE bucket IS NOT NULL AND object_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS media.object_cleanup_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket TEXT NOT NULL CHECK (bucket <> ''),
    object_key TEXT NOT NULL CHECK (object_key <> ''),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    claimed_at TIMESTAMPTZ,
    claim_token UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT object_cleanup_jobs_claim_check CHECK (
        (claimed_at IS NULL AND claim_token IS NULL)
        OR
        (claimed_at IS NOT NULL AND claim_token IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS object_cleanup_jobs_due_idx
    ON media.object_cleanup_jobs(next_attempt_at, created_at)
    WHERE completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS object_cleanup_jobs_pending_object_idx
    ON media.object_cleanup_jobs(bucket, object_key)
    WHERE completed_at IS NULL;
