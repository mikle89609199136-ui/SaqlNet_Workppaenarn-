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
--
-- Only when the column is not VARCHAR(64) yet: 0025_username_changes puts a
-- trigger on auth.users.username, and PostgreSQL refuses to change the type
-- of a column a trigger depends on — even to the same type. An unconditional
-- ALTER made every re-run of the migrations fail after 0025.
DO $$
BEGIN
    IF (SELECT character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'username')
       IS DISTINCT FROM 64 THEN
        ALTER TABLE auth.users ALTER COLUMN username TYPE VARCHAR(64);
    END IF;
END
$$;

-- Enforce unique lowercase username at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_lower_key
    ON auth.users (lower(username));

-- Drop the discriminator machinery.
ALTER TABLE auth.users
    DROP CONSTRAINT IF EXISTS auth_users_username_discriminator_key;

ALTER TABLE auth.users
    DROP COLUMN IF EXISTS username_discriminator;
