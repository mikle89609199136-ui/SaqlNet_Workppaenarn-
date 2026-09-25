CREATE TABLE IF NOT EXISTS auth.username_registry (
    username VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_username_registry_canonical CHECK (username = lower(username))
);

INSERT INTO auth.username_registry (username, user_id)
SELECT lower(username), id
FROM auth.users
ON CONFLICT (username) DO NOTHING;

CREATE INDEX IF NOT EXISTS auth_username_registry_user_idx
    ON auth.username_registry(user_id);

CREATE OR REPLACE FUNCTION auth.ensure_username_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO auth.username_registry (username, user_id)
    VALUES (lower(NEW.username), NEW.id)
    ON CONFLICT (username) DO NOTHING;

    IF NOT EXISTS (
        SELECT 1
        FROM auth.username_registry
        WHERE username = lower(NEW.username) AND user_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'username is already claimed: %', NEW.username
            USING ERRCODE = '23505', CONSTRAINT = 'auth_username_registry_pkey';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_users_ensure_username_claim ON auth.users;
CREATE TRIGGER auth_users_ensure_username_claim
AFTER INSERT OR UPDATE OF username ON auth.users
FOR EACH ROW EXECUTE FUNCTION auth.ensure_username_claim();

CREATE TABLE IF NOT EXISTS users.username_changes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    previous_username VARCHAR(64) NOT NULL,
    new_username VARCHAR(64) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_username_changes_different CHECK (previous_username <> new_username)
);

CREATE INDEX IF NOT EXISTS users_username_changes_user_changed_idx
    ON users.username_changes(user_id, changed_at DESC);

COMMENT ON TABLE users.username_changes IS
    'Immutable audit trail for username renames; also enforces the rename cooldown.';

COMMENT ON TABLE auth.username_registry IS
    'Lifetime username claims. Old names stay bound to their original account to prevent deep-link takeover.';
