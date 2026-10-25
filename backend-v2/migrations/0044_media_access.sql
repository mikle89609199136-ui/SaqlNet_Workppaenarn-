-- Track reliable media attachments so upload identifiers no longer grant download access.
ALTER TABLE media.uploads ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE media.uploads ADD COLUMN IF NOT EXISTS first_attached_at TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'media.uploads'::regclass AND conname = 'media_uploads_purpose_check') THEN
        ALTER TABLE media.uploads ADD CONSTRAINT media_uploads_purpose_check
            CHECK (purpose IN ('message', 'avatar', 'gif', 'sticker', 'unknown'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS media.upload_refs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id UUID NOT NULL REFERENCES media.uploads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('message','avatar','chat_avatar','gif','sticker')),
    message_id UUID REFERENCES messages.messages(id) ON DELETE CASCADE,
    chat_id UUID REFERENCES chats.chats(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    gif_id UUID REFERENCES media.gifs(id) ON DELETE CASCADE,
    sticker_id UUID REFERENCES media.stickers(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (kind = 'message' AND message_id IS NOT NULL AND chat_id IS NOT NULL AND num_nonnulls(user_id, gif_id, sticker_id) = 0) OR
        (kind = 'avatar' AND user_id IS NOT NULL AND num_nonnulls(message_id, chat_id, gif_id, sticker_id) = 0) OR
        (kind = 'chat_avatar' AND chat_id IS NOT NULL AND num_nonnulls(message_id, user_id, gif_id, sticker_id) = 0) OR
        (kind = 'gif' AND gif_id IS NOT NULL AND num_nonnulls(message_id, chat_id, user_id, sticker_id) = 0) OR
        (kind = 'sticker' AND sticker_id IS NOT NULL AND num_nonnulls(message_id, chat_id, user_id, gif_id) = 0)
    ),
    CHECK (kind <> 'avatar' OR user_id IS NOT NULL),
    CHECK (kind <> 'chat_avatar' OR chat_id IS NOT NULL),
    CHECK (kind <> 'gif' OR gif_id IS NOT NULL),
    CHECK (kind <> 'sticker' OR sticker_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS media_upload_refs_upload_idx ON media.upload_refs(upload_id);
CREATE INDEX IF NOT EXISTS media_upload_refs_message_idx ON media.upload_refs(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_upload_refs_chat_idx ON media.upload_refs(chat_id) WHERE chat_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS media_upload_refs_message_unique ON media.upload_refs(upload_id, message_id) WHERE kind = 'message';
CREATE UNIQUE INDEX IF NOT EXISTS media_upload_refs_avatar_unique ON media.upload_refs(upload_id, user_id) WHERE kind = 'avatar';
CREATE UNIQUE INDEX IF NOT EXISTS media_upload_refs_chat_avatar_unique ON media.upload_refs(upload_id, chat_id) WHERE kind = 'chat_avatar';
CREATE UNIQUE INDEX IF NOT EXISTS media_upload_refs_gif_unique ON media.upload_refs(upload_id, gif_id) WHERE kind = 'gif';
CREATE UNIQUE INDEX IF NOT EXISTS media_upload_refs_sticker_unique ON media.upload_refs(upload_id, sticker_id) WHERE kind = 'sticker';

WITH sources AS (
    SELECT g.url, 'gif' AS kind, NULL::uuid AS message_id, NULL::uuid AS chat_id,
           NULL::uuid AS user_id, g.id AS gif_id, g.created_at AS attached_at
    FROM media.gifs g
    UNION ALL
    SELECT p.avatar_url, 'avatar', NULL, NULL, p.user_id, NULL, NULL FROM users.profiles p
    UNION ALL
    SELECT c.avatar_url, 'chat_avatar', NULL, c.id, NULL, NULL, NULL FROM chats.chats c
    UNION ALL
    SELECT m.metadata->>'mediaUrl', 'message', m.id, m.chat_id, NULL, NULL, m.created_at
    FROM messages.messages m
)
INSERT INTO media.upload_refs (upload_id, kind, message_id, chat_id, user_id, gif_id, created_at)
SELECT u.id, s.kind, s.message_id, s.chat_id, s.user_id, s.gif_id, COALESCE(s.attached_at, u.created_at)
FROM sources s
JOIN media.uploads u ON u.id::text = lower(substring(s.url FROM 15))
WHERE s.url ~ '^/api/v2/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
ON CONFLICT DO NOTHING;

-- Shared uploads prefer message purpose; access is determined solely by refs.
UPDATE media.uploads u
SET first_attached_at = LEAST(COALESCE(u.first_attached_at, 'infinity'::timestamptz), r.attached_at),
    purpose = CASE r.priority WHEN 1 THEN 'message' WHEN 2 THEN 'avatar' ELSE 'gif' END
FROM (
    SELECT upload_id, min(created_at) AS attached_at,
           min(CASE kind WHEN 'message' THEN 1 WHEN 'avatar' THEN 2 WHEN 'chat_avatar' THEN 2 ELSE 3 END) AS priority
    FROM media.upload_refs WHERE kind <> 'sticker'
    GROUP BY upload_id
) r
WHERE u.id = r.upload_id;
