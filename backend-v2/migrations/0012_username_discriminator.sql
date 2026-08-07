-- Add per-username discriminator (0–999) so multiple users can share the same base username.
-- Displayed as "username.N" (e.g. "alex.247"). Existing users receive a random discriminator.
DO $$
BEGIN
  -- Once 0018 has created the lowercase username index, this historical
  -- migration must stay a no-op on subsequent compose starts.
  IF to_regclass('auth.auth_users_username_lower_key') IS NOT NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'username_discriminator'
  ) THEN
    ALTER TABLE auth.users
      ADD COLUMN username_discriminator SMALLINT NOT NULL DEFAULT 0;

    UPDATE auth.users
      SET username_discriminator = floor(random() * 1000)::SMALLINT;
  END IF;

  ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS auth_users_username_key;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'auth.users'::regclass
      AND conname = 'auth_users_username_discriminator_key'
  ) THEN
    ALTER TABLE auth.users
      ADD CONSTRAINT auth_users_username_discriminator_key
      UNIQUE (username, username_discriminator);
  END IF;
END
$$;
