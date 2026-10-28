-- updated_at is the content/entities edit timestamp, not a generic row clock.
-- Preserve historical timestamps and the legacy importer: actual edits keep
-- the timestamp explicitly provided by their writer. No historical rows change.
CREATE OR REPLACE FUNCTION messages.preserve_content_edit_timestamp() RETURNS trigger AS $$
BEGIN
    IF NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.entities IS NOT DISTINCT FROM OLD.entities THEN
        NEW.updated_at := OLD.updated_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS preserve_content_edit_timestamp ON messages.messages;
CREATE TRIGGER preserve_content_edit_timestamp
    BEFORE UPDATE ON messages.messages
    FOR EACH ROW EXECUTE FUNCTION messages.preserve_content_edit_timestamp();
