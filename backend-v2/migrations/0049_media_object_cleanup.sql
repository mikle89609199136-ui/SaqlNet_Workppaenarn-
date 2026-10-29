-- Preserve coordinates and shared media when its uploader is removed.
ALTER TABLE media.uploads ALTER COLUMN uploader_id DROP NOT NULL;
ALTER TABLE media.uploads DROP CONSTRAINT IF EXISTS uploads_uploader_id_fkey;
ALTER TABLE media.uploads ADD CONSTRAINT uploads_uploader_id_fkey
    FOREIGN KEY (uploader_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- A durable deletion fence: once storage deletion starts, a new attachment
-- cannot resurrect that identity, including during retries after a crash.
CREATE TABLE IF NOT EXISTS media.object_deletions (
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bucket, object_key)
);

CREATE OR REPLACE FUNCTION media.object_is_referenced(b TEXT, k TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
    SELECT 1 FROM media.uploads u JOIN media.upload_refs r ON r.upload_id = u.id
    LEFT JOIN messages.messages m ON m.id = r.message_id
    WHERE u.bucket = b AND u.object_key = k
      AND (r.kind <> 'message' OR m.deleted_at IS NULL AND m.id IS NOT NULL)
    UNION ALL SELECT 1 FROM media.stickers WHERE bucket = b AND object_key = k
    UNION ALL SELECT 1 FROM media.sticker_packs WHERE icon_bucket = b AND icon_object_key = k
 )
$$;

CREATE OR REPLACE FUNCTION media.queue_object(b TEXT, k TEXT) RETURNS VOID
LANGUAGE sql AS $$
 INSERT INTO media.object_cleanup_jobs(bucket, object_key) SELECT b, k WHERE b <> '' AND k <> ''
 AND NOT EXISTS (SELECT 1 FROM media.object_deletions WHERE bucket=b AND object_key=k)
 ON CONFLICT (bucket, object_key) WHERE completed_at IS NULL DO UPDATE
 SET next_attempt_at = LEAST(media.object_cleanup_jobs.next_attempt_at, EXCLUDED.next_attempt_at)
$$;

CREATE OR REPLACE FUNCTION media.guard_object(b TEXT, k TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
 IF b IS NULL OR k IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(b), hashtext(k));
 IF EXISTS (SELECT 1 FROM media.object_deletions WHERE bucket=b AND object_key=k) THEN
    RAISE EXCEPTION 'media object deletion has started' USING ERRCODE='23514';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION media.guard_upload_ref() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b TEXT; k TEXT;
BEGIN
 SELECT bucket, object_key INTO b,k FROM media.uploads WHERE id=NEW.upload_id;
 PERFORM media.guard_object(b,k);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_upload_ref ON media.upload_refs;
CREATE TRIGGER guard_upload_ref BEFORE INSERT OR UPDATE ON media.upload_refs
 FOR EACH ROW EXECUTE FUNCTION media.guard_upload_ref();

CREATE OR REPLACE FUNCTION media.track_upload_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
    PERFORM media.guard_object(NEW.bucket, NEW.object_key);
    INSERT INTO media.object_cleanup_jobs(bucket,object_key,next_attempt_at)
    VALUES (NEW.bucket,NEW.object_key,NEW.created_at + INTERVAL '7 days')
    ON CONFLICT (bucket,object_key) WHERE completed_at IS NULL DO NOTHING;
    RETURN NEW;
 END IF;
 IF TG_OP = 'DELETE' THEN
    PERFORM media.queue_object(OLD.bucket, OLD.object_key);
    RETURN OLD;
 END IF;
 IF NEW.bucket IS DISTINCT FROM OLD.bucket OR NEW.object_key IS DISTINCT FROM OLD.object_key THEN
    RAISE EXCEPTION 'upload storage identity is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.uploader_id IS NOT NULL AND NEW.uploader_id IS NULL THEN
    PERFORM media.queue_object(OLD.bucket, OLD.object_key);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS track_upload_cleanup ON media.uploads;
CREATE TRIGGER track_upload_cleanup BEFORE INSERT OR UPDATE OR DELETE ON media.uploads
 FOR EACH ROW EXECUTE FUNCTION media.track_upload_cleanup();

CREATE OR REPLACE FUNCTION media.queue_removed_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM media.queue_object(bucket, object_key) FROM media.uploads WHERE id=OLD.upload_id;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS queue_removed_ref ON media.upload_refs;
CREATE TRIGGER queue_removed_ref AFTER DELETE ON media.upload_refs
 FOR EACH ROW EXECUTE FUNCTION media.queue_removed_ref();

CREATE OR REPLACE FUNCTION media.queue_deleted_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM media.queue_object(u.bucket,u.object_key)
    FROM media.upload_refs r JOIN media.uploads u ON u.id=r.upload_id WHERE r.message_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS queue_deleted_message ON messages.messages;
CREATE TRIGGER queue_deleted_message AFTER UPDATE OF deleted_at ON messages.messages
 FOR EACH ROW EXECUTE FUNCTION media.queue_deleted_message();

-- Cover catalog cascades too; direct storage identities do not use upload_refs.
CREATE OR REPLACE FUNCTION media.track_catalog_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b TEXT; k TEXT; nb TEXT; nk TEXT;
BEGIN
 IF TG_TABLE_NAME = 'stickers' THEN
    IF TG_OP <> 'INSERT' THEN b:=OLD.bucket; k:=OLD.object_key; END IF;
    IF TG_OP <> 'DELETE' THEN nb:=NEW.bucket; nk:=NEW.object_key; END IF;
 ELSE
    IF TG_OP <> 'INSERT' THEN b:=OLD.icon_bucket; k:=OLD.icon_object_key; END IF;
    IF TG_OP <> 'DELETE' THEN nb:=NEW.icon_bucket; nk:=NEW.icon_object_key; END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN PERFORM media.guard_object(nb,nk); END IF;
 IF TG_OP <> 'INSERT' AND (TG_OP='DELETE' OR b IS DISTINCT FROM nb OR k IS DISTINCT FROM nk) THEN
    PERFORM media.queue_object(b,k);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS track_sticker_cleanup ON media.stickers;
CREATE TRIGGER track_sticker_cleanup BEFORE INSERT OR UPDATE OR DELETE ON media.stickers
 FOR EACH ROW EXECUTE FUNCTION media.track_catalog_cleanup();
DROP TRIGGER IF EXISTS track_pack_cleanup ON media.sticker_packs;
CREATE TRIGGER track_pack_cleanup BEFORE INSERT OR UPDATE OR DELETE ON media.sticker_packs
 FOR EACH ROW EXECUTE FUNCTION media.track_catalog_cleanup();

CREATE OR REPLACE FUNCTION media.prepare_object_cleanup(b TEXT,k TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(b),hashtext(k));
 IF media.object_is_referenced(b,k) THEN RETURN FALSE; END IF;
 -- A queued orphan must still respect the upload grace period.
 IF EXISTS (SELECT 1 FROM media.uploads WHERE bucket=b AND object_key=k
     AND first_attached_at IS NULL AND uploader_id IS NOT NULL
     AND created_at > NOW()-INTERVAL '7 days') THEN RETURN FALSE; END IF;
 INSERT INTO media.object_deletions(bucket,object_key) VALUES(b,k) ON CONFLICT DO NOTHING;
 RETURN TRUE;
END $$;
