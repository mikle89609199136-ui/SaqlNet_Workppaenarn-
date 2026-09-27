-- Remove unsafe GIF URLs and clear oversized or control-containing names before enforcing GIF constraints.
DELETE FROM media.gifs
WHERE url !~* '^/api/v2/media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

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
            CHECK (url ~* '^/api/v2/media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'media.gifs'::regclass AND conname = 'gifs_name_length_check'
    ) THEN
        ALTER TABLE media.gifs ADD CONSTRAINT gifs_name_length_check
            CHECK (char_length(name) <= 255);
    END IF;
END
$$;
