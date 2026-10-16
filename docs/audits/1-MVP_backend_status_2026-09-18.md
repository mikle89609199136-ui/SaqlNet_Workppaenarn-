# MVP: состояние бэкенда

> **Настройки пересмотрены 16 октября 2026:** см.
> [актуальный аудит настроек](settings-audit-2026-10-16.md).
> Сведения ниже о настройках/сеансах относятся к 18 сентября и частично устарели.
> Источник обязательного оформления — #728; animation/GIF controls исключены из MVP.


Дата статического аудита: 2026-09-18  
Проверенный commit: `d93a9ab`  
Источник требований: `MVP_scope_draft.md`

## Как читать статусы

- **Сделано** — endpoint, хранение и основная доменная логика присутствуют.
- **Начато** — часть контракта/хранения реализована, но требование MVP закрыто не полностью.
- **Не сделано** — необходимого backend-контракта или хранения нет.
- Оценка основана на Go-коде, migrations и OpenAPI; она не заменяет интеграционный прогон всего развёрнутого стека.

## Основной MVP scope

| Раздел | Статус | Что уже есть | Что осталось |
|---|---|---|---|
| 1. Авторизация и доступ | **Начато** | Register/login/logout/logout-all, token revocation, sessions, change password, 2FA и QR endpoints. | Нет password recovery/reset flow. HTTP auth остаётся bearer-based; cookie auth отсутствует. Модель `auth.sessions` и legacy `public.user_sessions` используется неоднородно. |
| 2. E2E-шифрование | **Начато** | Legacy wrapped chat keys, Signal key bundle/prekeys и MLS endpoints/schema, сервер хранит ciphertext/metadata, encrypted media supported. | Multi-device/new-device history recovery не закрыт подтверждённым протоколом end-to-end. Нужны зафиксированный production protocol, migration strategy и интеграционные тесты reconnect/device replacement/forward/edit. |
| 3. Личные чаты | **Сделано с оговорками** | Private create/list/get, chat members, last message, unread count, presence/status, user search, realtime broadcasts. | Privacy enforcement и reconnect consistency требуют интеграционной проверки. |
| 4.1. Базовые сообщения | **Начато** | Send/list, chronological DB ordering, realtime delivery, unread calculation, outbox events. | Нет отдельной модели sent/delivered/read per message. `POST /messages/read` принимает `messageIds`, но вызывает `MarkRead(chatId)` и игнорирует IDs; точное время прочтения каждого сообщения не хранится. |
| 4.2. Ответы | **Сделано** | `reply_to` в schema, валидация принадлежности чату, поля reply preview. | Добавить/сохранить E2E integration coverage для reconnect и смены ключей. |
| 4.3. Редактирование | **Сделано на API** | `PUT /messages/{messageId}`, owner check, `is_edited`, `updated_at`, realtime update. | Убедиться, что API явно возвращает/документирует edit timestamp для UI. |
| 4.4. Удаление | **Начато** | `DELETE /messages/{messageId}` удаляет собственное сообщение и рассылает событие. | Нет удаления «только у себя» и соответствующей per-user visibility table. Нет batch endpoint. |
| 4.5. Реакции | **Сделано с оговорками** | Toggle add/remove/replace, одна reaction пользователя на message, aggregation, GET list, realtime/tests. | Для требования «автор реакции» нужен endpoint/response с пользователями, а не только count + `myReaction`. |
| 4.6. Закрепление | **Начато** | Chat-wide pins table + GET/POST/DELETE endpoints. | Нет персонального pin mode «у себя»; текущий pin общий для чата. |
| 4.7–4.8. Copy/save | **Не требует отдельного backend API** | Media download поддерживает GET/HEAD/Range и content disposition. | Проверить CORS/content headers и безопасное скачивание всех типов в deployment. |
| 4.9. Пересылка | **Сделано** | `POST /messages/{messageId}/forward`, проверка доступа, metadata исходного автора/медиа, тесты. | Для атомарной multi-forward можно добавить batch endpoint; сейчас клиент вызывает endpoint по одному. |
| 4.10. Multi-select | **Начато на уровне одиночных API** | Одиночные delete/forward/pin позволяют клиенту выполнить пачку. | Нет batch/transaction contract; нет delete-for-self/all. |
| 5. Форматирование | **Не сделано как контракт** | `content` хранится строкой. | Определить безопасный формат entities/ranges или ограниченный markup, validation/sanitization, E2E encryption compatibility и versioning. Не принимать произвольный HTML. |
| 6. Медиа и файлы | **Сделано с оговорками** | Authenticated upload, metadata, size limits, filename/MIME limits, object storage, encrypted media validation, GET/HEAD/Range, cleanup/tests. | Синхронизировать лимиты/allowlist с фронтом; upload progress — задача транспорта/фронта. Проверить production object-store and E2E smoke. |
| 7. Избранное | **Сделано на бэке** | Migration `messages.favorites`, `GET /messages/favorites`, `POST/DELETE /messages/{messageId}/favorite`, service methods и типизированные OpenAPI responses. | Добавить tests для media/file favorites и pagination edge cases; подключить frontend. Учесть, что текущий handler toggle-ит состояние и для POST, и для DELETE. |
| 8. Звонки 1:1 | **Начато** | Room REST, in-memory call manager, WebSocket signaling/ICE, STUN/TURN config, invite/accept/reject/leave, сохранение call-message после закрытия. | Active room state теряется при рестарте; reconnect звонка не восстановлен надёжно. `calls.rooms` создаётся, но ended_at/participants lifecycle фактически не ведётся полностью. Ограничить/отделить group calls согласно MVP. |
| 9. Недавние звонки | **Не сделано как API** | Итог звонка сохраняется в `messages.messages` как `type='call'` со status/duration/initiatorId. Таблицы calls существуют. | Нет `GET /calls/history`, направления для каждого участника, нормального missed/rejected lifecycle, pagination и повторного звонка. `calls.rooms.ended_at` и `calls.participants` не заполняются полностью. |
| 10. Мой профиль | **Начато** | `GET/PUT /users/me`, avatar update, public profile, search/check username. | Нет endpoint изменения username. Нужны проверки uniqueness/rate limits/audit для будущего rename. |
| 11. Устройства | **Обновлено 16 октября** | Auth-сессии записываются, current определяется по token hash, logout-all работает. | #706 в работе: каноническая модель и revoke одной сессии; [детали](settings-audit-2026-10-16.md). |
| 12. Уведомления и звуки | **Обновлено 16 октября** | Push subscriptions/delivery (#717), global notifications filter, per-chat preview (#560). | Personal mute #559, source of truth #496 и миграция consumers; [детали](settings-audit-2026-10-16.md). |
| 13. Конфиденциальность | **Обновлено 16 октября** | Typed privacy schema, центральная policy, исключения, фото/пересылка/last seen и calls enforcement. | UI calls ещё отсутствует; direct connection #855 — отдельная функция. [Аудит](settings-audit-2026-10-16.md). |
| 14. Оформление | **Начато как универсальное хранение** | `GET/PUT /users/settings` merge arbitrary JSON; defaults содержат dark/language/etc. | Нет schema validation/enums/versioning, поэтому backend не гарантирует допустимые значения. Системная тема и расширенные поля пока не зафиксированы контрактом. |
| 15. Язык | **Сделано как хранение** | `language` сохраняется в settings JSON. | Добавить allowlist/versioned validation, если backend должен гарантировать поддерживаемые языки. |
| 16. Realtime | **Начато, основа готова** | WebSocket, user connections, chat broadcasts, reactions/read/calls, ping/pong, origin check. | Auth использует token query/header, не cookie. Logout/revocation не закрывает уже открытые сокеты немедленно. In-memory pending invites/rooms теряются при restart и не масштабируются между chat replicas. |
| 17. Технические требования | **Не выполнено полностью** | Origin validation, revocation checks при handshake, heartbeat и DB outbox присутствуют. | Cookie auth нет; bearer в WS URL поддерживается и используется; logout-all не fan-out закрывает sockets; per-message read IDs/timestamps отсутствуют. |
| 18. UI / UX | **Не backend-раздел** | Единые JSON errors, status codes, limits и часть validation есть. OpenAPI синхронизирован для messages, calls и encryption/Signal. | Типизировать оставшиеся generic settings/admin/media responses и обеспечить стабильные error codes для всех UI states. |
| 19. Не входит | **Скоуп расходится с кодом** | Backend поддерживает group call room до 5 участников. | Либо закрыть group calls feature flag/validation для MVP, либо изменить scope. |
| 20. Известные GAP | **Подтверждены** | В частности: call history, username change, session/token linkage, Web Push, privacy coverage, read receipts, bearer WS query. | Использовать как release blockers, а не только как справочный список. |

## Реализованные backend endpoints MVP

Публичный префикс: `/api/v2`.

### Auth и sessions

| Метод и путь | Состояние / назначение |
|---|---|
| `POST /auth/register` | регистрация |
| `POST /auth/login` | вход, выдача bearer token |
| `POST /auth/logout` | отзыв текущего токена |
| `POST /auth/logout-all` | revoke auth sessions пользователя |
| `GET /auth/sessions` | список `auth.sessions` |
| `POST /auth/change-password` | смена пароля при известном текущем |
| `GET/POST /auth/2fa/*` | status/enable/disable/verify |
| — | recovery/request-reset/confirm-reset отсутствуют |

### Users/settings/privacy/devices

| Метод и путь | Состояние / назначение |
|---|---|
| `GET/PUT /users/me` | профиль; username не меняется |
| `PUT /users/avatar` | avatar URL/data contract |
| `GET /users/check-username` | проверка доступности username |
| `GET /users/search` | поиск пользователей |
| `GET /users/{userId}/profile` | публичный профиль |
| `GET/PUT /users/settings` | generic JSON settings merge |
| `GET/PUT /users/privacy` | generic privacy JSON merge |
| `GET/POST /users/blocked`, `DELETE /users/blocked/{userId}` | blacklist |
| `GET /users/devices`, `POST /users/devices/register`, `DELETE /users/devices/{sessionId}`, `POST /users/devices/terminate-all` | legacy device model; требует унификации с auth sessions |

### Chats/messages/media

| Метод и путь | Состояние / назначение |
|---|---|
| `GET /chats`, `POST /chats/private`, `GET /chats/{chatId}` | private chat flow |
| `GET/POST /messages/{chatId}` | history/send |
| `PUT/DELETE /messages/{messageId}` | edit/delete-for-all |
| `POST /messages/read` | **дефект:** принимает, но игнорирует `messageIds` |
| `POST /messages/{messageId}/forward` | forward one |
| `GET/POST /messages/{messageId}/reactions` | list/toggle reaction |
| `GET/POST/DELETE /chats/{chatId}/pins...` | chat-wide pins |
| `GET /messages/favorites`, `POST/DELETE /messages/{messageId}/favorite` | favorites |
| `POST /media`, `GET/HEAD /media/{id}` | upload/download/range |

### Calls/realtime

| Метод и путь | Состояние / назначение |
|---|---|
| `GET /calls/ice-servers` | STUN/TURN config |
| `GET/POST /calls/rooms` | active in-memory rooms/create |
| `GET /calls/rooms/{id}` | active room details |
| `GET /ws?token=...` | realtime/signaling; текущая небезопасная token-query схема |
| — | history endpoint отсутствует |

## Отдельно: блок после `+**********************`

### 7. Оформление и 10. Язык — обновление 16 октября

См. [детальную матрицу реализации, контрактов и задач](settings-audit-2026-10-16.md).

- Light/dark, fallback avatar и RU/EN уже сохраняются и применяются.
- Палитра и акцент уже имеют picker и применяются, но сохраняются только локально (#828).
- Группировка сообщений, групповые аватары и delivery/read statuses уже существуют;
  в #728 нужны пользовательские переключатели, а не повторная реализация renderer.
- System theme, textSize, chatDensity и четыре visibility/grouping flags ещё не реализованы.
- Для серверного хранения нужны schema/defaults/validation/migration (#453/#451/#495/#728),
  согласование endpoints (#498) и синхронизации.
- Анимации интерфейса, animated emoji/stickers и autoplay GIF **не входят в #728/MVP**.

### 11. Звонки — записывать последние звонки

Статус: **начато, но отдельной истории нет**.

Есть:

- `POST /api/v2/calls/rooms` создаёт строку `calls.rooms` и in-memory room;
- WebSocket ведёт signaling;
- при закрытии последним участником создаётся `messages.messages(type='call')` с `callKind`, `status`, `duration`, `initiatorId`.

Проблемы текущей модели:

- `calls.rooms.ended_at` не обновляется;
- `calls.participants` не отражает join/leave;
- rejected/busy/cancelled и направление для конкретного пользователя не образуют надёжную историю;
- in-memory room исчезает при рестарте;
- фильтрация call-сообщений по всем чатам отдельным endpoint отсутствует.

Нужный endpoint:

```text
GET /api/v2/calls/history?cursor=<opaque>&limit=50&kind=audio|video&status=answered|missed
```

Минимальный элемент ответа:

```json
{
  "id": "uuid",
  "roomId": "uuid",
  "chatId": "uuid",
  "peer": { "id": "uuid", "username": "alice", "firstName": "Alice", "avatarUrl": "..." },
  "direction": "incoming | outgoing",
  "kind": "audio | video",
  "status": "answered | missed | rejected | cancelled",
  "startedAt": "RFC3339",
  "answeredAt": "RFC3339 | null",
  "endedAt": "RFC3339 | null",
  "durationSeconds": 42
}
```

Что сделать:

1. Доработать calls schema (или ввести immutable `calls.history/events`).
2. Писать lifecycle транзакционно при create/invite/accept/reject/end/disconnect.
3. Проверять, что запрашивающий был участником звонка.
4. Добавить cursor pagination и индексы по participant + started_at.
5. Описать endpoint в OpenAPI и добавить integration tests для answered/missed/rejected/reconnect.

### 21. Информация от разработчика

Для версии frontend backend endpoint не нужен: она внедряется сборщиком. Если в UI требуется именно информация о сервере, предлагается read-only endpoint:

```text
GET /api/v2/meta
```

Пример безопасного ответа: `apiVersion`, `buildVersion`, `commit`, `builtAt`. Не отдавать environment secrets, internal hostnames и полную конфигурацию. Сейчас такого endpoint нет.

## Приоритетные backend blockers для MVP

1. Cookie-based auth для HTTP и WebSocket; немедленное закрытие sockets на logout/logout-all.
2. Per-message read receipts с idempotency, batch IDs и точным `readAt`.
3. Единая модель auth sessions/devices и отзыв одной конкретной сессии.
4. Password recovery flow.
5. Privacy enforcement на уровне service/policy, а не только JSON settings.
6. Call lifecycle/history endpoint и durable state.
7. Типизированная/валидируемая settings schema для обязательного appearance block.
