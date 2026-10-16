-- auth.sessions.id is the canonical credential/device ID. Preserve known
-- links only; matching by User-Agent or IP can merge independent devices.
ALTER TABLE auth.sessions
    ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'sessions'
          AND column_name = 'device_session_id'
    ) THEN
        UPDATE auth.sessions s
        SET device_name = COALESCE(NULLIF(d.device_name, ''), s.device_name),
            device_type = COALESCE(NULLIF(d.device_type, ''), s.device_type),
            ip_address = COALESCE(NULLIF(d.ip_address, ''), s.ip_address),
            location = COALESCE(d.location, ''),
            user_agent = COALESCE(d.user_agent, ''),
            last_active = GREATEST(s.last_active, d.last_active)
        FROM public.user_sessions d
        WHERE s.device_session_id = d.id AND s.user_id = d.user_id;
    END IF;
END
$$;

-- Refresh-only legacy rows cannot identify a current access token. Unknown
-- access tokens are rejected by the checker and require a fresh login.
UPDATE auth.sessions SET revoked_at = NOW()
WHERE access_token_hash IS NULL AND revoked_at IS NULL;

ALTER TABLE auth.sessions DROP COLUMN IF EXISTS device_session_id;
-- public.user_sessions remains a frozen legacy snapshot for import tooling.
-- Runtime services no longer read or write it; is_current is request-relative.
