-- Remove unsafe GIF URLs before extracting their upload IDs.
DELETE FROM media.gifs
WHERE url !~ '^/api/v2/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- Keep only GIFs backed by the owner's own unencrypted GIF upload. Legacy
-- global rows have no owner, so they cannot satisfy the ownership rule.
DELETE FROM media.gifs AS gif
WHERE NOT EXISTS (
    SELECT 1
    FROM media.uploads AS upload
    WHERE upload.id = split_part(gif.url, '/', 5)::uuid
      AND upload.uploader_id = gif.user_id
      AND lower(btrim(split_part(upload.content_type, ';', 1))) = 'image/gif'
      AND NOT upload.is_encrypted
);

UPDATE media.gifs
SET name = ''
WHERE char_length(name) > 255 OR name ~ U&'[\0001-\001F\007F-\009F]';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'media.gifs'::regclass AND conname = 'gifs_url_media_path_check'
    ) THEN
        ALTER TABLE media.gifs ADD CONSTRAINT gifs_url_media_path_check
            CHECK (url ~ '^/api/v2/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'media.gifs'::regclass AND conname = 'gifs_name_length_check'
    ) THEN
        ALTER TABLE media.gifs ADD CONSTRAINT gifs_name_length_check
            CHECK (char_length(name) <= 255);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'media.gifs'::regclass AND conname = 'gifs_name_control_check'
    ) THEN
        ALTER TABLE media.gifs ADD CONSTRAINT gifs_name_control_check
            CHECK (name !~ U&'[\0001-\001F\007F-\009F]');
    END IF;
END
$$;
