-- Export user media index
-- For query: SELECT id, filename, content_type, size_bytes, created_at
-- FROM media.uploads WHERE uploader_id = $1 ORDER BY created_at ASC

CREATE INDEX IF NOT EXISTS media_uploads_uploader_created_idx ON media.uploads (uploader_id, created_at);
