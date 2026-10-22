-- Every writer (canonical, bulk and legacy) publishes the same invalidation.
-- PostgreSQL delivers NOTIFY after COMMIT; rollback/failed writes emit nothing.
CREATE OR REPLACE FUNCTION users.notify_settings_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('crane_settings_changed',
        json_build_object('userId', NEW.user_id::text, 'version', 1)::text);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_changed ON users.settings;
CREATE TRIGGER settings_changed AFTER UPDATE ON users.settings
FOR EACH ROW
WHEN (OLD.settings IS DISTINCT FROM NEW.settings
   OR OLD.privacy_settings IS DISTINCT FROM NEW.privacy_settings
   OR OLD.notification_settings IS DISTINCT FROM NEW.notification_settings
   OR OLD.sound_settings IS DISTINCT FROM NEW.sound_settings
   OR OLD.storage_settings IS DISTINCT FROM NEW.storage_settings
   OR OLD.advanced_settings IS DISTINCT FROM NEW.advanced_settings
   OR OLD.folders IS DISTINCT FROM NEW.folders)
EXECUTE FUNCTION users.notify_settings_changed();
