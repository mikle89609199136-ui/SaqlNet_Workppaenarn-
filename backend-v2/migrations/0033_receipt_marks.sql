-- Статусы доставки и прочтения (#657). У получателя в чате две границы:
-- «прочитано до» (last_read_at, #506) и «доставлено до». Журнал хранит
-- каждый сдвиг границы: до какого момента и когда — одна запись на сдвиг,
-- а не на сообщение. Время доставки или прочтения сообщения — когда
-- граница получателя впервые его перешла.
ALTER TABLE chats.user_chat_settings ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS chats.receipt_marks (
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('delivered', 'read')),
    up_to TIMESTAMPTZ NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id, kind, up_to)
);

-- Время сообщения — первый по времени сдвиг, перешедший его: поиск по
-- чату и виду в порядке времени сдвига.
CREATE INDEX IF NOT EXISTS receipt_marks_chat_kind_at_idx
    ON chats.receipt_marks (chat_id, kind, at) INCLUDE (user_id, up_to);

-- Прочитанное до выпуска: граница «доставлено» стартует от «прочитано», в
-- журнал — нынешняя отметка с её же временем (для старых сообщений время
-- приблизительное). Только для пар без записей в журнале: повторный прогон
-- не подменяет настоящее время более ранним.
UPDATE chats.user_chat_settings
SET last_delivered_at = last_read_at
WHERE last_read_at IS NOT NULL
  AND (last_delivered_at IS NULL OR last_delivered_at < last_read_at);

INSERT INTO chats.receipt_marks (chat_id, user_id, kind, up_to, at)
SELECT cs.chat_id, cs.user_id, k.kind, cs.last_read_at, cs.last_read_at
FROM chats.user_chat_settings cs
CROSS JOIN (VALUES ('delivered'), ('read')) AS k(kind)
WHERE cs.last_read_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chats.receipt_marks r WHERE r.chat_id = cs.chat_id AND r.user_id = cs.user_id
  )
ON CONFLICT DO NOTHING;
