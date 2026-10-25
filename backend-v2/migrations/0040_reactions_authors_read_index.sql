-- 0040_reactions_authors_read_index.sql
-- Индекс для списка авторов реакций и подсчёта реакций по сообщению и emoji.
-- Порядок полей поддерживает сортировку и границу курсора:
-- (created_at DESC, user_id DESC).

CREATE INDEX IF NOT EXISTS idx_reactions_message_emoji_created_user
    ON messages.reactions (message_id, emoji, created_at DESC, user_id DESC);
