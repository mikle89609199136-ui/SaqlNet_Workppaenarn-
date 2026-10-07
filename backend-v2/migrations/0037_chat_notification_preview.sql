-- Personal notification preference; never changes another member's settings.
ALTER TABLE chats.user_chat_settings
    ADD COLUMN IF NOT EXISTS hide_notification_preview BOOLEAN NOT NULL DEFAULT FALSE;
