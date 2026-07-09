-- Add per-username discriminator (0–999) so multiple users can share the same base username.
-- Displayed as "username.N" (e.g. "alex.247"). Existing users receive a random discriminator.
ALTER TABLE auth.users
  ADD COLUMN username_discriminator SMALLINT NOT NULL DEFAULT 0;

-- Existing rows all have unique usernames, so any discriminator assignment is safe.
UPDATE auth.users
  SET username_discriminator = floor(random() * 1000)::SMALLINT;

-- Replace single-column unique key with composite key.
ALTER TABLE auth.users DROP CONSTRAINT auth_users_username_key;
ALTER TABLE auth.users
  ADD CONSTRAINT auth_users_username_discriminator_key UNIQUE (username, username_discriminator);
