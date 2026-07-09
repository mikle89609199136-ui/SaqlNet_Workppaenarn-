-- Message favorites
CREATE TABLE IF NOT EXISTS messages.favorites (
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS messages_favorites_user_idx ON messages.favorites(user_id, created_at DESC);

-- Full-text search index on message content
CREATE INDEX IF NOT EXISTS messages_content_search_idx ON messages.messages USING gin(to_tsvector('simple', content));
