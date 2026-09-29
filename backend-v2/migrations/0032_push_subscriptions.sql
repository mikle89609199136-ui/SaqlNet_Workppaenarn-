-- Web Push (#717): подписки устройств. Одна строка — один браузер или
-- установленное приложение; endpoint выдаёт push-сервис (Google, Mozilla,
-- Apple, Microsoft), p256dh и auth — ключи шифрования содержимого push.
CREATE TABLE IF NOT EXISTS users.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON users.push_subscriptions (user_id);
