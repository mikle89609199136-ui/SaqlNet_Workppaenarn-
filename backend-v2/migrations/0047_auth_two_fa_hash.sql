-- New writes may never enable 2FA without a usable hash. Keep invalid legacy
-- rows unchanged: disabling 2FA for them would silently bypass its protection.
-- Login rejects those rows until their configuration is repaired explicitly.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'auth.users'::regclass
          AND conname = 'auth_users_enabled_two_fa_hash'
    ) THEN
        ALTER TABLE auth.users ADD CONSTRAINT auth_users_enabled_two_fa_hash
            CHECK (NOT two_fa_enabled OR COALESCE(two_fa_hash ~ '[^[:space:]]', FALSE))
            NOT VALID;
    END IF;
    -- Validate clean installations; legacy corruption must not block rollout
    -- of the login fix. Re-running after repair validates the existing check.
    IF NOT EXISTS (
        SELECT 1 FROM auth.users
        WHERE two_fa_enabled AND NOT COALESCE(two_fa_hash ~ '[^[:space:]]', FALSE)
    ) THEN
        ALTER TABLE auth.users VALIDATE CONSTRAINT auth_users_enabled_two_fa_hash;
    END IF;
END;
$$;
