-- Инвалидация для собеседников без содержимого настроек/исключений.
-- NOTIFY доставляется PostgreSQL только после commit.
CREATE OR REPLACE FUNCTION users.notify_call_privacy_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE owner UUID;
BEGIN
    IF TG_TABLE_NAME = 'settings' THEN
        IF TG_OP = 'UPDATE' AND (OLD.privacy_settings->'calls') IS NOT DISTINCT FROM (NEW.privacy_settings->'calls') THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'DELETE' THEN owner := OLD.user_id; ELSE owner := NEW.user_id; END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            IF OLD.rule <> 'calls' THEN RETURN OLD; END IF;
            owner := OLD.owner_id;
        ELSE
            IF NEW.rule <> 'calls' THEN RETURN NEW; END IF;
            IF TG_OP = 'UPDATE' AND OLD.allow IS NOT DISTINCT FROM NEW.allow THEN RETURN NEW; END IF;
            owner := NEW.owner_id;
        END IF;
    END IF;
    PERFORM pg_notify('crane_call_privacy_changed', json_build_object('userId', owner::text)::text);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_privacy_changed ON users.settings;
CREATE TRIGGER call_privacy_changed AFTER INSERT OR UPDATE OF privacy_settings OR DELETE ON users.settings
FOR EACH ROW EXECUTE FUNCTION users.notify_call_privacy_changed();

DROP TRIGGER IF EXISTS call_privacy_exception_changed ON users.privacy_exceptions;
CREATE TRIGGER call_privacy_exception_changed AFTER INSERT OR UPDATE OR DELETE ON users.privacy_exceptions
FOR EACH ROW EXECUTE FUNCTION users.notify_call_privacy_changed();
