-- Access-token sessions issued by the Go auth service.
--
-- refresh_token_hash belongs to the legacy refresh-token model. The current
-- service issues access tokens only, so keep the legacy value for migrated
-- rows and store a one-way access-token fingerprint separately.
ALTER TABLE auth.sessions
    ALTER COLUMN refresh_token_hash DROP NOT NULL;

ALTER TABLE auth.sessions
    ADD COLUMN IF NOT EXISTS access_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS token_generation BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_access_token_hash_key
    ON auth.sessions(access_token_hash)
    WHERE access_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_active_user_idx
    ON auth.sessions(user_id, token_generation, last_active DESC)
    WHERE revoked_at IS NULL;
