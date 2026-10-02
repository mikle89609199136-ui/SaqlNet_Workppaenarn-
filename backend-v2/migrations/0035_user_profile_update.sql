-- ============================================================
-- users.profiles becomes the single source of truth for
-- first_name / last_name (and all other profile fields).
-- auth.users.first_name / last_name are a historical snapshot
-- taken at registration and must NOT be read for display.
-- ============================================================

-- 1.1 Backfill: create missing profiles from auth.users snapshot.
INSERT INTO users.profiles (user_id, first_name, last_name)
SELECT id, first_name, last_name
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 1.2 Keep future registrations in sync via trigger.
CREATE OR REPLACE FUNCTION users.create_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO users.profiles (user_id, first_name, last_name)
    VALUES (NEW.id, NEW.first_name, NEW.last_name)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_profile_for_new_user ON auth.users;
CREATE TRIGGER trg_create_profile_for_new_user
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION users.create_profile_for_new_user();

-- 1.3 Document the role of auth.users.first_name / last_name.
COMMENT ON COLUMN auth.users.first_name IS
    'Historical snapshot from registration. Do not use for display; '
    'users.profiles.first_name is the source of truth.';
COMMENT ON COLUMN auth.users.last_name IS
    'Historical snapshot from registration. Do not use for display; '
    'users.profiles.last_name is the source of truth.';