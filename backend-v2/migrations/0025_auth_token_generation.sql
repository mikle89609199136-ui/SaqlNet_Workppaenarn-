-- Monotonic per-user generation for revoking every previously issued access token.
-- Existing JWTs implicitly belong to generation 0.
ALTER TABLE auth.users
    ADD COLUMN IF NOT EXISTS token_generation BIGINT NOT NULL DEFAULT 0;
