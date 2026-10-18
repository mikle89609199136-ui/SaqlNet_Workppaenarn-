-- Personal message notifications; independent of moderation in chats.members (#559).
ALTER TABLE chats.user_chat_settings
    ADD COLUMN IF NOT EXISTS notifications_muted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notifications_muted_until TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_chat_settings_notification_mute_check'
          AND conrelid = 'chats.user_chat_settings'::regclass
    ) THEN
        ALTER TABLE chats.user_chat_settings
            ADD CONSTRAINT user_chat_settings_notification_mute_check
            CHECK (notifications_muted_at IS NOT NULL OR notifications_muted_until IS NULL);
    END IF;
END $$;
