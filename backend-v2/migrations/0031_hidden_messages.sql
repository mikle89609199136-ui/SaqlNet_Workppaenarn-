-- Удаление сообщения только у себя (#840).
--
-- Сообщение остаётся у остальных участников; тому, кто его скрыл, оно не
-- отдаётся нигде — в истории, списке чатов, закреплённых, поиске и
-- избранном — и не считается в непрочитанных. Номер 0031, а не 0030:
-- 0030 занят в открытом PR про GIF (#861); миграции учитываются по имени
-- файла, так что порядок слияния не важен.
CREATE TABLE IF NOT EXISTS messages.hidden_messages (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Порядок столбцов под проверку «скрыто ли мной»: (зритель, сообщение).
    PRIMARY KEY (user_id, message_id)
);
