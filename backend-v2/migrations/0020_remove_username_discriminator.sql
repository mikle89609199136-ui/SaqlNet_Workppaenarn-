DO $$
DECLARE
    lower_username_index_exists BOOLEAN;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name = 'users'
          AND column_name = 'username_discriminator'
    ) THEN
        RETURN;
    END IF;

    lower_username_index_exists :=
        to_regclass('auth.auth_users_username_lower_key') IS NOT NULL;

    IF lower_username_index_exists THEN
        -- Recover databases where the old migration appended another suffix
        -- before failing because the lowercase index already existed.
        UPDATE auth.users
        SET username = left(
            username,
            length(username) - length('.' || username_discriminator::text)
        )
        WHERE username LIKE '%.' || username_discriminator::text;
    ELSE
        UPDATE auth.users
        SET username = username || '.' || username_discriminator::text;
    END IF;
END
$$;

-- Increase username length to fit existing base.N values.
ALTER TABLE auth.users
    ALTER COLUMN username TYPE VARCHAR(64);

-- Enforce unique lowercase username at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_lower_key
    ON auth.users (lower(username));

-- Drop the discriminator machinery.
ALTER TABLE auth.users
    DROP CONSTRAINT IF EXISTS auth_users_username_discriminator_key;

ALTER TABLE auth.users
    DROP COLUMN IF EXISTS username_discriminator;
