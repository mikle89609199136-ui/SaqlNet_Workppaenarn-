# Сквозное шифрование: актуальный аудит

**Первичная версия:** 27 августа 2026, commit `f08da3c`<br>
**Актуализировано:** 18 сентября 2026, commit `d93a9ab`<br>
**Проверено:** frontend crypto modules, `CryptoService`, message/media flow, realtime key rotation, backend encryption handlers/routes/migrations.<br>
**Метод:** статический аудит и существующие unit/integration tests; отдельный ручной security E2E двух браузеров не выполнялся.

---

## Итог

Вывод версии от 27 августа «группы — base64, сервер читает всё» больше не соответствует коду. В текущем frontend реализован собственный протокол envelope v2:

- один случайный 256-bit key на чат и эпоху;
- ключ заворачивается через ECDH отдельно для каждого участника;
- HKDF-SHA-256 разделяет назначения `msg`, `media`, `wrap` и связывает ключ с чатом;
- AES-GCM защищает текст и медиа;
- ECDSA P-256 подписывает envelope;
- chat ID, epoch и sender ID входят в AEAD/signature context;
- приватные identity keys неизвлекаемы и сохраняются как `CryptoKey` в IndexedDB;
- одна схема используется для private и group chats;
- при изменении состава владелец группы инициирует новую эпоху.

Это настоящее клиентское шифрование, а не прежняя кодировка. При обычной пассивной утечке БД содержимое сообщений и файлов без локальных ключей не читается.

При этом реализация остаётся собственным протоколом без double ratchet/MLS semantics. Главные незакрытые области — доверие к identity directory при первом контакте, forward secrecy, multi-device и конкурентная ротация.

## Текущая схема

### Identity

Для аккаунта браузер создаёт две пары P-256:

- ECDH — для заворачивания chat key;
- ECDSA — для подписи сообщений.

Публичные ключи кодируются одной versioned bundle и публикуются одновременно в:

- `POST /api/v2/encryption/keys` → `crypto.user_public_keys`;
- `POST /api/v2/auth/public-key` → `auth.public_keys`.

Двойная публикация нужна текущему frontend/backend flow, но означает, что источника identity всё ещё два. Приватные ключи создаются с `extractable: false` и хранятся в `craneapp_crypto`.

### Ключ чата

`ChatKeyManager` создаёт 32 random bytes и для каждого участника записывает отдельный sealed blob через:

- `GET/POST /api/v2/encryption/chat-keys/{chatId}`;
- `GET /api/v2/encryption/my-key/{chatId}`;
- `POST /api/v2/encryption/rotate-key/{chatId}`.

Старые эпохи сохраняются только на устройствах, которые их уже получили. При смене состава новая эпоха не выдаётся бывшим участникам и не открывает новому участнику старую историю.

### Сообщения и медиа

Envelope v2 содержит `v`, `e2e`, `epoch`, `iv`, `data`, fingerprint hint и ECDSA signature. Сервер сохраняет валидный encrypted JSON без HTML escaping. Media payload использует тот же chat key/epoch, но отдельный HKDF purpose.

Сообщения прежней схемы намеренно показываются как устаревшие и не расшифровываются: доверять их неподписанному sender key небезопасно.

## Что исправлено относительно версии 27 августа

| Старая находка | Состояние 18 сентября |
|---|---|
| Group text — `[MLS]` + base64 | **Исправлено:** envelope v2 + chat key. |
| Group media key выводился из серверного state | **Исправлено:** локальный chat key, отдельный media purpose. |
| Сервер мог незаметно переписать sender ID/ciphertext | **Существенно исправлено:** sender/chat/epoch/ciphertext связаны AES-GCM AAD и ECDSA signature. |
| Нет HKDF / один AES-key для всего | **Исправлено:** HKDF и разделение назначений. |
| Приватный ключ extractable | **Исправлено.** |
| Нет key epochs/rotation | **Исправлено частично:** rotation при member added/removed. |
| Frontend не использовал `chat-keys` | **Исправлено.** |
| Signal routes 404 | **Исправлено на backend:** routes зарегистрированы. Frontend их не использует. |
| Нет сообщений о смене identity | **Исправлено частично:** `SafetyCodeNotice` сообщает о смене bundle. |

## Оставшиеся находки

### 1. Доверие при первом контакте и server MITM

Публичная identity bundle приходит с того же сервера, который доставляет сообщения. Первая связка принимается без внешнего доказательства. Сервер, способный подменить bundle до первого контакта, может организовать MITM.

После смены уже известной bundle клиент сохраняет прежние fingerprints и показывает `SafetyCodeNotice`, но:

- уведомление сообщает только факт смены;
- фактический safety code/fingerprint не показан пользователю;
- нет QR/числового кода для сверки вне приложения;
- текущая bundle проверяется первой, поэтому сообщение с новым ключом может получить `senderVerified: true` одновременно с предупреждением о смене.

Нужно: экран кода безопасности, out-of-band comparison, явное состояние trusted/unverified/changed и policy — разрешать ли отправку до подтверждения.

### 2. Нет forward secrecy внутри эпохи

Один chat key действует до ротации. Компрометация этого ключа раскрывает все сообщения и медиа его эпохи. Ротация по изменению состава ограничивает прошлый/будущий доступ участников, но не заменяет double ratchet.

Для production-grade forward secrecy нужен стандартный ratchet/MLS, а не дополнительная самописная эволюция envelope.

### 3. Multi-device не является полноценным протоколом

Identity хранится локально на одном браузере, а backend имеет одну текущую запись public identity на пользователя. Новое устройство публикует новую bundle поверх прежней. Другой участник может «долечить» текущий chat key под новую bundle, однако:

- старые локальные epoch keys на новое устройство не попадают;
- история до доступной эпохи не восстанавливается;
- старое устройство не представлено отдельной identity и может потерять доступ к будущим ключам;
- нет списка device identities, cross-signing и отдельного revoke устройства.

Это напрямую расходится с MVP-требованиями нескольких устройств и истории после входа на новом устройстве.

### 4. Две активные таблицы identity и ещё две параллельные схемы

Текущий клиент публикует одну bundle в `auth.public_keys` и `crypto.user_public_keys`. Параллельно существуют Signal tables/routes и MLS tables/routes. Получаются три направления протокола:

1. используемый envelope v2 + chat keys;
2. готовая, но не используемая Signal infrastructure;
3. готовая частично, но не используемая MLS infrastructure.

Нужно выбрать целевую схему, назначить единственный authoritative identity store и удалить либо явно заморозить остальные контракты.

### 5. Распределение эпохи не транзакционно

`SaveChatKeys` upsert-ит строки участников по одной. Клиент после записи перечитывает собственную строку, но это не доказывает, что все участники получили один и тот же key. Одновременное initial ensure/rotation может создать split-brain одной эпохи.

Owner-only rotation по realtime events снижает риск при смене состава, но не закрывает:

- одновременное первое открытие нового чата;
- повторную доставку member events;
- несколько вкладок владельца;
- частичную ошибку БД посередине списка.

Нужны server transaction, compare-and-set `(chat_id, epoch)`, единый distributor/leader и integration race tests.

### 6. Ротация зависит от realtime и роли владельца

Ротацию после `chat_member_added/removed` запускает только открытый frontend владельца. Если владелец offline либо событие потеряно, backend сам новую эпоху не создаёт. `heal` доворачивает существующий key, но не должен выдавать ушедшему будущие данные; гарантию membership даёт backend row filtering, однако момент ротации остаётся клиентским best effort.

Надёжнее фиксировать смену epoch как обязательную часть server-side member transaction, оставляя key material клиенту/назначенному участнику.

### 7. XSS всё ещё остаётся критичной

Неизвлекаемый `CryptoKey` нельзя экспортировать, что уменьшает ущерб от чтения IndexedDB. Но активный malicious script в origin всё ещё может вызывать WebCrypto операции, читать plaintext из DOM/state и отправлять сообщения от имени пользователя. Нужны строгая CSP, отсутствие unsafe-inline/eval, dependency hygiene и отдельный XSS review.

### 8. Нет подтверждённого cross-browser security E2E

Unit tests покрывают envelope, signatures, identity и chat-key flows; backend имеет handler/service tests. Они не заменяют сценарии двух реальных профилей/браузеров с IndexedDB, WebSocket и object storage.

## Матрица защиты

| Угроза | Текущее состояние |
|---|---|
| Пассивный дамп БД | Текст и encrypted media защищены; metadata остаётся видимой. |
| Перехват сети вне TLS endpoint | Защищено TLS + message encryption. |
| Подмена sender/chat/ciphertext в БД | AEAD/signature должны обнаружить подмену. |
| Malicious server при первом identity contact | **Не закрыто без внешней сверки fingerprint.** |
| Компрометация одного chat key | Раскрывает всю соответствующую эпоху. |
| Кража bearer token | Не даёт старые локальные private keys автоматически, но позволяет менять server identity/session state и атаковать будущий обмен. |
| XSS в клиентском origin | Может читать plaintext и использовать ключи через API браузера. |
| Новое/второе устройство | Частичное healing текущего key; полноценная история и параллельная работа не гарантированы. |

## Endpoints

| Endpoint | Используется frontend | Назначение |
|---|---|---|
| `POST /api/v2/auth/public-key` | да | legacy/chat DTO identity copy |
| `POST /api/v2/encryption/keys` | да | identity bundle + fingerprint |
| `GET /api/v2/encryption/keys/{userId}` | да | peer identity |
| `GET/POST /api/v2/encryption/chat-keys/{chatId}` | да | wrapped keys участников |
| `POST /api/v2/encryption/rotate-key/{chatId}` | да | новая эпоха + audit/rate limit |
| `GET /api/v2/encryption/my-key/{chatId}` | да | wrapped key текущего пользователя |
| `/api/v2/encryption/signal/*` | нет | зарегистрированная, но не используемая Signal infrastructure |
| `/api/v2/mls/*` | нет текущим message flow | параллельная MLS infrastructure |

## Приоритет до MVP

1. Принять решение: envelope v2 как ограниченный MVP-протокол или переход на стандартный Signal/MLS.
2. Реализовать полноценную device identity/session модель.
3. Сделать safety-code UI и trust state.
4. Перенести epoch coordination в атомарный server contract.
5. Добавить browser E2E suite: private/group text, media, reply/edit/forward, rotation, reconnect, member join/leave, new device.
6. Добавить CSP/XSS hardening.
7. Документировать, что channels не E2E и что история старого формата намеренно недоступна.

## Проверка после актуализации

- Frontend tests: 125 файлов, 759 тестов — пройдены 18 сентября 2026.
- Backend `go test ./...` — пройден 18 сентября 2026.
- Эти результаты подтверждают regression suite, но не являются независимым криптографическим аудитом или formal verification.
