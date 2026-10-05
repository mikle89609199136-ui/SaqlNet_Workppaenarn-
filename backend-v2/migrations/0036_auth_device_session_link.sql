-- Link a token-backed auth session to the legacy device record that was
-- registered by the same authenticated client. The relation is optional for
-- pre-rollout tokens, but one device record can belong to at most one current
-- credential mapping.
ALTER TABLE auth.sessions
    ADD COLUMN IF NOT EXISTS device_session_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_sessions_device_session_id_fkey'
          AND conrelid = 'auth.sessions'::regclass
    ) THEN
        ALTER TABLE auth.sessions
            ADD CONSTRAINT auth_sessions_device_session_id_fkey
            FOREIGN KEY (device_session_id)
            REFERENCES public.user_sessions(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_device_session_id_key
    ON auth.sessions(device_session_id)
    WHERE device_session_id IS NOT NULL;
