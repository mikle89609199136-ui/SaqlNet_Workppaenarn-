-- 2FA fields on auth.users
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS two_fa_hash TEXT;

-- Revoked tokens (for logout / logout-all)
CREATE TABLE IF NOT EXISTS auth.revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_revoked_tokens_user_idx ON auth.revoked_tokens(user_id);
CREATE INDEX IF NOT EXISTS auth_revoked_tokens_expires_idx ON auth.revoked_tokens(expires_at);

-- Device sessions with metadata (device name, IP, etc.)
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ NOT NULL DEFAULT NOW();
