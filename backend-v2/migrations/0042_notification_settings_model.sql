-- #1042: one-time normalization; new/recovered rows already use canonical defaults.
ALTER TABLE users.settings ADD COLUMN IF NOT EXISTS notification_model_version SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users.settings ALTER COLUMN notification_model_version SET DEFAULT 1;

-- Internal rollback snapshot, never returned by User API or logged. Deleting
-- settings/account removes it too. Original legacy aliases remain untouched.
CREATE TABLE IF NOT EXISTS users.notification_settings_backup_v1 (
    user_id UUID PRIMARY KEY REFERENCES users.settings(user_id) ON DELETE CASCADE,
    settings JSONB NOT NULL,
    sound_settings JSONB NOT NULL,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users.notification_settings_backup_v1 (user_id, settings, sound_settings)
SELECT user_id, settings, sound_settings FROM users.settings WHERE notification_model_version = 0
ON CONFLICT (user_id) DO NOTHING;

WITH normalized AS (
    SELECT user_id,
        CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END AS base,
        CASE
            WHEN jsonb_typeof(settings) IS DISTINCT FROM 'object' THEN FALSE
            WHEN settings ? 'notifications' THEN settings->'notifications' = 'true'::jsonb
            ELSE TRUE
        END AS notifications,
        CASE
            WHEN jsonb_typeof(settings) IS DISTINCT FROM 'object' THEN FALSE
            WHEN settings ? 'sounds' THEN settings->'sounds' = 'true'::jsonb
            WHEN jsonb_typeof(sound_settings) IS DISTINCT FROM 'object' THEN FALSE
            ELSE (NOT (sound_settings ? 'messagesSound') OR sound_settings->'messagesSound' = 'true'::jsonb)
             AND (NOT (sound_settings ? 'notificationsSound') OR sound_settings->'notificationsSound' = 'true'::jsonb)
        END AS sounds,
        CASE
            WHEN jsonb_typeof(settings) IS DISTINCT FROM 'object' THEN FALSE
            WHEN settings ? 'callSounds' THEN settings->'callSounds' = 'true'::jsonb
            WHEN jsonb_typeof(sound_settings) IS DISTINCT FROM 'object' THEN FALSE
            WHEN sound_settings ? 'callsSound' THEN sound_settings->'callsSound' = 'true'::jsonb
            ELSE TRUE
        END AS call_sounds
    FROM users.settings WHERE notification_model_version = 0
)
UPDATE users.settings s
SET settings = n.base || jsonb_build_object('notifications', n.notifications, 'sounds', n.sounds, 'callSounds', n.call_sounds),
    notification_model_version = 1
FROM normalized n WHERE s.user_id = n.user_id;
