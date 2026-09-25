-- Присутствие пользователя (#780).
--
-- Источник правды — подключение по WebSocket: чат-сервис отмечает
-- пользователя в сети при первом подключении, продлевает отметку по
-- heartbeat и снимает её, когда закрыто последнее соединение.
--
-- «В сети» = online AND last_seen_at свежее срока аренды (presence.LeaseTTL):
-- если процесс упал, не сняв отметку, она сама перестанет считаться живой.
-- «Был(а)» = last_seen_at.
--
-- Прежде «в сети» считалось по user_sessions.last_active за пять минут, а
-- это поле обновляется только при регистрации устройства: «был в сети»
-- показывало время последнего входа.
--
-- Идемпотентна: локальный стенд прогоняет все миграции при каждом запуске.
CREATE TABLE IF NOT EXISTS users.presence (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    online BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
