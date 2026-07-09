-- Add description to reports
ALTER TABLE admin.reports ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Add mute columns to users
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS mute_reason TEXT;
