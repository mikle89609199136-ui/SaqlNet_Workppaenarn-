-- Исключения из правил приватности по людям (#784).
--
-- Владелец открывает правило конкретному человеку (allow = TRUE, «всегда
-- разрешать») или закрывает от него (allow = FALSE, «никогда не
-- разрешать») поверх базового значения из users.settings.privacy_settings.
-- Порядок решения — в internal/platform/privacy: сам себе, чёрный список,
-- исключение, базовое правило.
--
-- По одному исключению на человека и правило: попав в один список, человек
-- уходит из другого. Какие правила допустимы, проверяет сервис — так новое
-- правило не требует миграции.
--
-- Первичный ключ начинается с (owner_id, user_id): проверка ищет все
-- исключения владельца для одного зрителя.
--
-- Повторяемая, как все миграции.
CREATE TABLE IF NOT EXISTS users.privacy_exceptions (
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    allow BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, user_id, rule),
    CHECK (owner_id <> user_id)
);

-- Список исключений владельца по правилу — для экрана настроек.
CREATE INDEX IF NOT EXISTS idx_privacy_exceptions_owner_rule
    ON users.privacy_exceptions (owner_id, rule, created_at DESC);
