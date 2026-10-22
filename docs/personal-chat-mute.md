# Персональные уведомления чата

Реализация #559, 17 октября 2026. Отключение уведомлений сообщений владельцем отделено от moderator mute участника: первое хранится в chats.user_chat_settings, второе ограничивает отправку сообщений через chats.members и остаётся без изменений.

## API

`POST /api/v2/chats/{chatId}/mute` принимает обязательный JSON object:

```json
{ "mutedUntil": "2030-01-01T08:00:00Z" }
```

RFC3339 timestamp должен быть в будущем. `{}` или `{"mutedUntil":null}` отключает уведомления бессрочно. Для «на 8 часов» клиент передаёт соответствующее будущее время; отдельного серверного каталога длительностей нет. `DELETE /api/v2/chats/{chatId}/mute` включает оповещения обратно, тело не читается. Повторный POST/DELETE безопасен. Оба возвращают `200 {"success":true}` после успешной записи.

Операция меняет только аутентифицированного участника. Unknown/case-variant keys, неверный root/type/timestamp и прошедший срок дают `400 validation_failed`; malformed/empty/trailing JSON — `400 invalid_json`. Неверный chatId — 400, чужой/несуществующий чат — `403 access_denied`, другой метод — `405 method_not_allowed`, ошибка БД — `500 internal_error`. Membership проверяется в том же SQL statement, что и upsert; неуспешная проверка не создаёт personal settings row.

Детали чата и обычный/архивный список возвращают:

- `isMuted`: effective boolean текущего владельца; false при отсутствии настройки и после истечения срока.
- `mutedUntil`: UTC timestamp будущего окончания; отсутствует при isMuted=false или бессрочном mute. Бессрочное отключение различается по isMuted=true.

Клиентская DTO содержит эти поля. В #725 реализованы toggle меню, optimistic list/archive/detail с field-only rollback, refetch и подавление browser fallback/звука. Quiet badge учитывает expiry без нового сообщения. UI задаёт бессрочный mute; временный API сохранён. Подробности — [клиентская policy](notification-client-policy.md). Рассылка изменений другим открытым клиентам остаётся #1041; нового realtime event здесь нет.

## Хранение и доставка

Новая повторяемая migration 0041_personal_chat_mute.sql добавляет notifications_muted_at и notifications_muted_until. Обе NULL означают отсутствие mute; muted_at задан и until NULL — бессрочный; будущий until — временный. CHECK запрещает until без muted_at. Старые строки получают выключенный mute; backfill не нужен. Истечение вычисляется при чтении/доставке, cleanup job не требуется.

Upsert меняет только две колонки personal mute. Pin/archive/preview/read state, сообщения, unread counts, preferences других участников и moderator restrictions сохраняются. Другое устройство видит тот же server state.

Push Directory получает контекст события. Перед отправкой KindMessage исключаются все подписки владельца с активным mute именно этого чата. Другой чат/пользователь не затрагивается. KindCall и KindMissedCall не подавляются personal message mute; global notifications=false продолжает запрещать все виды push. Ни mute, ни global off не удаляют подписки и не сбрасывают индивидуальные предпочтения. Payload не расширяется и не содержит plaintext сообщения.

## Проверки и зависимости

HTTP/PostgreSQL regression tests проверяют private/group chats, бессрочный и временный mute, expiry без Sleep, повторные операции, другое устройство, чужого участника, сохранность соседних preferences и ошибку БД. Реальный Notifier с PostgreSQL Directory проверяет message/call/missed-call delivery на нескольких подписках, другой чат/пользователя, global off/on, expiry и независимый moderator mute. Мигратор проверяет повторное применение SQL.

#1042 использует этот personal mute при переходе notification/sound на единый resolver. #725 реализует frontend action и общую effective policy, #1041 отвечает за синхронизацию открытых клиентов.
