# Контракт User API

Решение USER-D001, #453, от 16 октября 2026. Основание — `dev` после #454/#706, handlers/services в `backend-v2/internal/user`, session/Origin middleware и edge gateway. В актуальном `paths/users.yaml` **46 операций**; исходные 39 в issue устарели. Все адреса ниже имеют префикс `/api/v2`.

Исполнимый источник — `backend-v2/contracts/openapi/{paths/users.yaml,components/schemas.yaml,components/responses.yaml}`. Из него генерируется `frontend/src/types/api.generated.ts`. Схемы фиксируют wire DTO и выбранные правила записи; сами по себе они не добавляют проверки, defaults или функции. Runtime validation разделов реализована в #495, единые [defaults — в #451](settings-defaults.md) (17 октября); остальные пробелы отмечены отдельно. Расхождения перечислены ниже и помечены у операций `x-contract-gaps`/описанием. Encryption/key-backup endpoints имеют отдельный контракт и в эти 46 операций не входят.

## Общие правила

- Все операции требуют session cookie, кроме `GET /users/check-username`. Public profile/status/QR также требуют сессию. Владелец настроек определяется сессией, а не присланным userId.
- Меняющие данные запросы с cookie проходят Origin-защиту (`403 cross_site_request`). Любая операция может получить gateway `429 rate_limited`, `500 internal_error`, `502 upstream_unavailable`; защищённые — `401 missing_token|invalid_token|token_revoked` и `503 auth_check_unavailable|crypto_protocol_not_ready|crypto_unavailable` до вызова handler.
- Ошибка — JSON `{code, message, requestId?}`. `code` — стабильный машинный идентификатор; текст `message` клиент не разбирает. `requestId` необязателен. У каждого HTTP status есть reusable response с точным enum кодов для операции; `x-error-codes` повторяет его в компактной матрице.
- `Retry-After` для 429 содержит целое число секунд, минимум 1. Переименование также возвращает `username_change_cooldown`; это другой отказ, чем gateway limit. Не вводим общий `409` для settings: CAS/ETag/revision API отсутствует.
- Обычный JSON decoder ограничен 128 KiB; push subscriptions — 8 KiB. Ошибка декодирования/лимита — `400 invalid_json`, не новый `413`. Trailing JSON ещё принимается (#450). Ни OpenAPI, ни тесты схем сами по себе не исправляют decoder.
- UUID — строка `format: uuid`. Строки имён/bio/avatar metadata сейчас не имеют отдельных серверных лимитов длины; предел размера JSON не означает наличие URL/доменной валидации. Не объявляем несуществующие ограничения реализованными.
- Большинство известных маршрутов на неправильный метод возвращают `405 method_not_allowed`. Storage/passcode возвращают `405 method_not_allowed` с `Allow`, содержащим единственный поддерживаемый метод (#449); неизвестные пути в этих обработчиках возвращают `404 route_not_found` без `Allow`. Остальные handlers не гарантируют `Allow`.

## DTO и nullable-семантика

`UserProfile` отделён от сокращённого `User`, используемого Auth API. Обязательны все девять полей: `id`, `username`, `firstName`, `lastName`, `bio`, `avatarUrl`, `badges`, `isPremium`, `isBot`. `lastName/bio/avatarUrl` могут быть пустыми строками. `badges` — массив строковых серверных идентификаторов или текущий legacy `null`; закрытого каталога badges нет. Публичная выдача маскирует фото по privacy, сохраняя поле с пустой строкой.

`PUT /users/me` — partial: отсутствующее/null поле сохраняется; пустой `firstName` игнорируется, пустые `lastName/bio/avatarUrl` очищают значение. В `PUT /users/avatar` приоритет у `avatarUrl`; когда он отсутствует/null, используется legacy `avatar`. Если оба отсутствуют/null, изменения нет. Формат URI для avatar URL текущий writer не проверяет. Неизвестные ключи этих старых struct-запросов сейчас игнорируются; это не strict settings patch.

| Коллекция                            | Текущий wire-тип       | Пустое значение и дальнейшее изменение                                               |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------ |
| Search `users`                       | `UserSearchItem[]?`    | Пустой запрос — `[]`; непустой без совпадений может дать `null`; нормализация — #435 |
| Blocklist `blocked`                  | `UserBlockedItem[]?`   | Может быть `null`; нормализация — #435                                               |
| Export `chats`                       | `UserExportChat[]?`    | Может быть `null`; нормализация — #435                                               |
| Profile `badges`                     | `string[]?`            | Может быть `null`; схема отражает текущую сериализацию                               |
| Devices `devices`                    | `DeviceSession[]`      | Всегда массив, пустое значение `[]` после #706                                       |
| Privacy exceptions `exceptions`      | `PrivacyException[]`   | Всегда массив, пустое значение `[]`                                                  |
| Legacy `folders` в GET/bulk snapshot | `LegacyFolderValue[]?` | После #451 JSON null нормализуется в []                                              |

`?` в этой таблице означает JSON null, а не отсутствие поля: ключи envelopes обязательны. После runtime-нормализации #435 nullability меняется отдельной правкой контракта и типов. `LegacyFolderValue` намеренно допускает произвольный JSON, включая вложенные объекты/массивы: сервер хранит `[]any`, предметной модели и активного MVP editor нет (#561). Это закрытое исключение для совместимости, а не разрешение произвольных settings keys.

Search ищет literal substring без учёта регистра в username, имени, фамилии и bio. Пробелы и ведущий `@` удаляются, `%`/`_` экранируются. Результат исключает текущего и disabled пользователей, отсортирован по username, максимум 50, без pagination.

| Timestamp                                      | Формат сейчас                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Devices `lastActive/firstLogin`                | UTC RFC 3339, возможны дробные секунды; `format: date-time`       |
| Privacy exception `createdAt`                  | UTC RFC 3339; `format: date-time`                                 |
| Presence `lastSeen`                            | RFC 3339 UTC **или пустая строка**, если скрыто/неизвестно        |
| Export `exportedAt`                            | UTC RFC 3339; `format: date-time`                                 |
| Blocklist `blockedAt`, export chat `createdAt` | PostgreSQL `timestamptz::text`, например `2026-10-16 18:00:00+00` |

Последние два поля — отдельная schema `DatabaseTimestamp`, без ложного `format: date-time`. Стандартизация их сериализации потребует runtime-правки. Presence дополнительно может вернуть `lastSeenApprox=recently|within_week|within_month|long_ago` по взаимным privacy rules.

## Канонические settings и privacy

Маршруты и переход legacy clients определены в [#498](settings-api.md), notification policy — в [#496](notification-settings.md), bulk — в [#454](settings-bulk-api.md).

`MvpSettings` — **flat partial object** с закрытыми ключами. `{}` — no-op. Отсутствующее поле сохраняется; root null, null leaf, array, неверный тип/enum и неизвестный ключ дают `400 validation_failed` до любого SQL для **всего** запроса (#495). Null не означает reset/delete. В частности, `false` — полноценное сохранённое значение, не отсутствие. GET/PUT возвращают envelopes с обязательным `settings`, GET также с обязательным `privacy`. Старый объект может не иметь некоторых leaf-полей до нормализации.

Defaults ниже применяются при создании/восстановлении/нормализованном чтении (#451), **не подставляются в patch**. [Appearance compatibility](appearance-settings.md) реализована в #1040 без backfill; notification aliases реализованы в [#1042](notification-settings-migration.md). Поэтому в request-схемах нет `required` для leaf-полей и JSON Schema `default`, превращающего необязательный PUT в обязательный при генерации типов.

| Поле                       | Тип / enum                                       | Default    | Семантика                                                                                                              |
| -------------------------- | ------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `theme`                    | `light / dark / system`                          | `dark`     | Хранить выбор system, вычислять светлую/тёмную тему на устройстве                                                      |
| `palette`                  | `graphite / midnight / warm`                     | `graphite` | Палитра фона, независима от theme/accent                                                                               |
| `accentPreset`             | `violet / plum / orchid / indigo / amber / teal` | `violet`   | Серверное имя нынешнего локального `accent`                                                                            |
| `textSize`                 | `small / medium / large`                         | `medium`   | Относительный масштаб текста; точные CSS metrics и visual tests — #728                                                 |
| `chatDensity`              | `compact / normal / large`                       | `normal`   | Размеры/отступы списка чатов, пузырей и composer; независим от textSize                                                |
| `showMessageTime`          | boolean                                          | `true`     | Видимость времени в ленте, метаданные сохраняются                                                                      |
| `showMessageStatus`        | boolean                                          | `true`     | Видимость outgoing delivery/read marks; не отключает receipts и обработку ошибок/retry                                 |
| `showMessageAvatars`       | boolean                                          | `true`     | Аватары отправителей **в ленте**, где поддержаны сейчас (входящие групповые сообщения); не список чатов/профили/звонки |
| `groupConsecutiveMessages` | boolean                                          | `true`     | Нынешние правила визуальной группировки; false делает пузыри самостоятельными                                          |
| `avatarShape`              | `letter / grid`                                  | `letter`   | Fallback без фото; реализация серверного default — #497                                                                |
| `language`                 | `ru / en`                                        | `ru`       | Missing server value → ru; первый выбор locale делает клиент, сохранённый выбор приоритетен                            |
| `notifications`            | boolean                                          | `true`     | Master для автоматических message/call alerts по #496                                                                  |
| `sounds`                   | boolean                                          | `true`     | Message sound, независим от callSounds                                                                                 |
| `callSounds`               | boolean                                          | `true`     | Incoming ringtone, не громкость разговора                                                                              |

Appearance enums/defaults из предварительного аудита теперь приняты этим контрактом. Animation/animated emoji/stickers/autoplay GIF не добавляются в MVP. Browser push permission/subscription и громкость голосовых остаются состоянием устройства. Новые значения не означают готовность UI: `system` и применение остальных Appearance controls реализуют #728/#1041; серверное хранение и совместимость готовы в #1040. Нынешний `ISettingsDto` остаётся моделью поддерживаемого UI с light/dark; полный wire type — генерируемый `MvpSettings`.

`PrivacySettingsPatch` отличен от output `PrivacySettings`: шесть visibility keys (`lastSeen`, `photoVisibility`, `phoneVisibility`, `forwards`, `calls`, `groupsAdd`) принимают `all/nobody`, а также compatibility aliases `everyone/everybody → all`, `contacts/none → nobody`. Contacts-модели нет. Null и неизвестные keys недопустимы. Ещё три keys — boolean `messagesFromStrangers/twoFactorAuth/autoDeleteAccount`. Последние два — старые сохранённые переключатели, не подтверждение наличия MFA/автоудаления. Для отсутствующих visibility defaults: phoneVisibility — nobody, остальные — all; сообщения от незнакомых — true, twoFactorAuth — false, autoDeleteAccount — true (сохраняем registration default). После #451 отсутствующий autoDeleteAccount получает true, сохранённый false не меняется; реального автоудаления это не включает.

`callsFrom` не является API key. Исключения — отдельные ресурсы с `rule` из шести visibility keys и `mode=allow|deny`; смена базового правила их не очищает. Проверка: сам владелец, блокировка, персональное исключение, базовое правило. Себя добавить нельзя (`400 self_exception`), неизвестный/disabled пользователь — `404 user_not_found`; удаление отсутствующего исключения успешно. Полный calls policy уже находится в описании `PrivacySettings.calls`.

## Типизированные compatibility-разделы

У каждого раздела именованная schema, все известные поля optional для partial write/старых sparse rows. Runtime validation #495 отклоняет неизвестные keys, null leaves и неверные типы до любого SQL, включая создание settings row. Те же typed DTO checks используются при service-вызовах. Старые неизвестные данные скрываются на чтении; это не новые MVP fields.

| Schema                       | Поля и ограничения                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LegacyGeneralSettings`      | MvpSettings плюс старые `accentColor` (hex `#RRGGBB`) и `fontSize=small/medium/large`. Новые клиенты используют accentPreset/textSize; fontSize → textSize реализован в #1040, canonical значение приоритетно; произвольный HEX сохраняется без подбора пресета                                                          |
| `LegacyNotificationSettings` | Boolean: privateChats, groups, channels, calls, videoCalls, inAppNotifications, messagePreview, readReceipts, reactions, newContacts. Legacy fallback true, кроме readReceipts=false; поведение — по #496                                   |
| `LegacySoundSettings`        | notificationsVolume/mediaVolume — integer **0…100** (fallback 80/100); notificationsSound/messagesSound/sendSound/callsSound/vibrateOnCall — boolean (fallback true); notificationSound/messageSound/ringtone — строки (fallback `default`) |
| `LegacyStorageSettings`      | autoDownloadMobile/autoDownloadWifi/autoDownloadRoaming — boolean; deleteMediaAfter — строковый legacy identifier, известное fallback `never`                                                                                               |
| `LegacyAdvancedSettings`     | Boolean: autoReconnect, fastConnection, dataCompression, saveDrafts, analytics, developerMode, debugLog, hardwareAcceleration, autoplayGifs; connectionType — строковый legacy identifier, fallback `auto`                                  |

Для sound IDs, deleteMediaAfter и connectionType **нет поддерживаемого серверного каталога**, поэтому не изобретаем enum, отбрасывающий существующие значения. Решение — сохранять opaque string в deprecated data без обещания playback/retention/connection поведения; предел длины — общий JSON body limit. Для advanced fallback при пустом объекте true у autoReconnect/fastConnection/dataCompression/saveDrafts/hardwareAcceleration/autoplayGifs, false у analytics/developerMode/debugLog. После #451 все маршруты используют единый источник defaults.

Legacy notification/sound/advanced GET возвращает `{settings: section}`, PUT — `{success: true, settings: section}`. Storage PUT имеет тот же envelope. Не перепутать эти ключи с названиями `notificationSettings/soundSettings/advancedSettings/storageSettings` в bulk snapshot. Dedicated folders PUT возвращает только `{success:true}`; обязательный non-null массив заменяется целиком (#441).

В bulk у каждого из шести object sections собственная nullable schema: **null разрешён только на уровне раздела** и означает no-op. Folders omitted/null сохраняет список, `[]` очищает. Правильно типизированные passcodeEnabled/passcodeTimeout read-only, принимаются и игнорируются для совместимости. Правила валидации aliases/приоритета canonical flags — #496/#1042; safe concurrent mutation — #1047. Полная семантика — [bulk contract](settings-bulk-api.md).

## Runtime validation и старые данные (#495)

Typed DTO: SettingsPatch, LegacySettingsPatch, NotificationSettingsPatch, SoundSettingsPatch, StorageSettingsPatch и AdvancedSettingsPatch. Они проверяют весь patch до любого SQL, включая ensureSettings. Корень canonical/section/bulk — объект, имена ключей точные (Theme не является theme). Неверный JSON/лимит тела — invalid_json; валидный JSON неправильной формы/типа — validation_failed. Указатели DTO сохраняют отличие omitted от false/0/пустой строки; null leaf недопустим. Bulk null section разрешён как no-op. Неизвестные root keys и неверно типизированные read-only passcode fields также отвергаются до записи.

Повреждённые сохранённые **object sections** читаются по документированной нормализации:

| Сохранённое значение                                    | Результат чтения                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Известный валидный key/value                            | Сохранить без изменения, включая false/0/opaque identifiers            |
| Неизвестный key                                         | Скрыть из wire DTO                                                     |
| Известный boolean неверного типа/null                   | false                                                                  |
| Неверная громкость/тип/диапазон                         | 0                                                                      |
| Неверный enum/строка/hex color                          | Default из #451, если определён; textSize сначала использует валидный legacy fontSize (#1040); прочие invalid aliases опускаются |
| Повреждённый корень общего settings (null/array/scalar) | notifications/sounds/callSounds=false, остальные keys из defaults      |
| Повреждённый корень detailed section                    | Известные booleans=false, volumes=0; строки из defaults                |
| Валидный пустой объект                                  | Полный default object в ответе; БД не переписывается (#451)            |

GET не переписывает существующую строку. Canonical GET отдаёт только MvpSettings; bulk/export дополнительно возвращают сохранённый accentColor и fontSize как проекцию разрешённого textSize (#1040). При записи очищается затронутый legacy/bulk object; omitted/null/empty bulk sections сохраняются в БД без изменений, даже если их данные повреждены. Canonical SQL patch сохраняет соседние stored keys; не-object root ремонтируется в закрытый notifications state перед merge. Пустой bulk (включая только read-only поля) не вызывает SQL. Единые defaults добавлены в #451 как read projection; глобального backfill Appearance нет. Notification flags однократно нормализует migration 0042; после неё legacy fallback не повторяется.

Все writable bulk sections записываются одним UPDATE после полной валидации: invalid mixed patch не создаёт строку и ничего не меняет, ошибка UPDATE не сохраняет часть разделов. В #1047 bulk/legacy section read-modify-write используют общую транзакцию: создание строки и чтение актуального snapshot под FOR UPDATE, sparse merge и commit. Ошибка UPDATE/COMMIT откатывает все изменения, включая создание строки. Canonical SQL writers сериализуются той же блокировкой; passcode не записывается из snapshot. Alias priority/conflict resolution и sound projections реализованы в #1042 до SQL и в том же locked mutation path. Privacy использует существующий Normalize/Parse (#439), dedicated folders и passcode timeout сохраняют свои отдельные задачи.

## Отдельные операции и их границы

**Devices.** Это view канонических `auth.sessions` после #706: stable UUID, `isCurrent` относительно cookie текущего запроса, текущая сессия первой, пустой массив `[]`. Registration изменяет metadata существующей сессии и возвращает `{success:true,sessionId}`, не создаёт credentials и не объединяет устройства по User-Agent. Четыре metadata поля заменяются на каждом вызове: omission/null декодируется в пустую строку и очищает поле. Сервер ставит location `Unknown`. DELETE одной текущей сессии — `409 conflict_current_session`; чужая/несуществующая — `404 not_found`. Terminate-all сохраняет текущую; `/auth/logout-all` отличается и отзывает также её.

**Passcode.** GET возвращает `{enabled,timeout}`; timeout в секундах. Set принимает строку минимум 4 **UTF-8 bytes после trim**, как проверяет Go, без объявленного numeric PIN/4–6 digits/верхнего лимита. Verify/disable используют точную строку; `400 no_passcode_set` и `401 wrong_passcode` отличаются от session 401. Timeout: обязательный integer ≥0; **0 отключает автоматическую повторную блокировку**, positive — задержка. Missing/negative должны давать 400 без изменения. Runtime пока заменяет missing/0/negative на 60, исправление — #442. Session cookie не заменяется успешной проверкой passcode.

**Export.** JSON attachment `craneapp_data.json`, обязательные поля `user/chats/settings/privacy/exportedAt`. Сейчас это profile, metadata чатов по membership, общие settings и privacy; не сообщения, media/files, приватные ключи, blocklist, exceptions, push subscriptions или детальные legacy sections. Чаты отсортированы по createdAt по убыванию. Полный архив с согласованным составом — #447; его новые поля нельзя обещать до реализации и изменения schema.

**Storage/delete-all/cache.** `storage.messages` сейчас SQL `SUM(LENGTH(content))` для собственных неудалённых сообщений: количество символов сохранённого content, **не physical bytes**. media/files/cache — нули-заглушки (#445). Cache clear только создаёт settings row при необходимости и отвечает success, фактической очистки нет (#446). Delete-all одной транзакцией удаляет authored messages, memberships, settings и blocklist в обоих направлениях; при ошибке транзакция откатывается. Auth account/profile, sessions, uploads/object storage и все остальные сущности не удаляются. Это не полное удаление аккаунта; расширение заявленной области — #448.

**Profile QR.** Выбран канонический шаблон `trusted-public-origin/user/@{canonicalUsername}`. Origin берётся из доверенной конфигурации публичного приложения; path содержит точный canonical username найденного существующего пользователя, нормализованный lookup ограничен 64 символами. QR response — `qrCode: data:image/png;base64,...` (256 px PNG), не login token. Сейчас origin берётся из недоверенных Host/X-Forwarded-Proto, исправление — #452. В React отсутствует landing route `/user/@…`: при внедрении #452 нужно обеспечить разрешение этого profile link; один корректный PNG не делает ссылку работающей. Имя env-переменной/новый endpoint этим docs PR не добавляется. Rename делает старый username link недействительным.

**Premium.** Нынешний `POST /premium/subscribe` требует только действующую сессию, создаёт профиль при необходимости и выставляет isPremium=true; response `{success:true}`. Payment receipt/оплата/проверка entitlement/предыдущая подписка не требуются и не проверяются. Решение этого контракта — описать существующую compatibility operation, не объявлять её checkout API и не добавлять выдуманный payment-required 402/409. Платный rollout потребует отдельного продуктового billing/entitlement контракта и защищённой выдачи premium; в #453 это не реализуется.

**Push.** VAPID key возвращается только при включённой серверной конфигурации, иначе `404 push_not_configured`. Subscription endpoint — HTTPS URI до 2048 bytes, без userinfo/явного port, host только из allowlist `internal/push/subscription.go`. Для p256dh проверяются base64 decode, 65 bytes и первый byte 0x04; проверка принадлежности точке кривой не реализована. Auth secret — 16 decoded bytes. Поддерживается standard/base64url, с padding или без. Endpoint upsert обновляет ключи и может переносить endpoint между аккаунтами на том же устройстве; максимум 20/account, старые вытесняются. DELETE удаляет только собственный endpoint, success **204 без JSON**. Ключи и allowlist дополнительно проверяются Go validator: одного format uri/JSON Schema для проверки decoded bytes недостаточно.

## Матрица операций

Во всех error responses схемы именованные, с точным набором `code` для данной операции. Общие 401/403/429/500/502/503 выше включены в OpenAPI; здесь указаны success и специфические отказы/неправильный метод. `400 validation_failed` для settings реализован в #495; dedicated folders/timeout ещё имеют отмеченные runtime gaps.

| Метод и путь                                       | Operation / request schema                                   | Success schema                         | Специфические ошибки                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /users/me`                                    | `getCurrentUser`                                             | 200 `ProfileResponse`                  | 404 `user_not_found`; 405 `method_not_allowed`                                                                             |
| `PUT /users/me`                                    | `updateCurrentUser`<br> `UpdateProfileRequest`               | 200 `ProfileResponse`                  | 400 `invalid_json`; 404 `user_not_found`; 405 `method_not_allowed`                                                         |
| `PUT /users/me/username`                           | `renameCurrentUser`<br> `RenameUsernameRequest`              | 200 `ProfileResponse`                  | 400 `invalid_json`; 404 `user_not_found`; 405 `method_not_allowed`; 409 `username_taken`                                   |
| `PUT /users/avatar`                                | `updateAvatar`<br> `UpdateAvatarRequest`                     | 200 `ProfileResponse`                  | 400 `invalid_json`; 404 `user_not_found`; 405 `method_not_allowed`                                                         |
| `GET /users/check-username`                        | `checkUsername`                                              | 200 `UsernameAvailabilityResponse`     | 400 `validation_failed`; 405 `method_not_allowed`                                                                          |
| `GET /users/search`                                | `searchUsers`                                                | 200 `UserSearchResponse`               | 405 `method_not_allowed`                                                                                                   |
| `GET /users/qr-code`                               | `getUserQrCode`                                              | 200 `ProfileQrResponse`                | 400 `validation_failed`; 404 `user_not_found`; 405 `method_not_allowed`                                                    |
| `GET /users/{userId}/profile`                      | `getPublicProfile`                                           | 200 `ProfileResponse`                  | 400 `validation_failed`; 404 `user_not_found / route_not_found`; 405 `method_not_allowed`                                  |
| `GET /users/{userId}/status`                       | `getUserStatus`                                              | 200 `UserStatus`                       | 400 `validation_failed`; 404 `user_not_found / route_not_found`; 405 `method_not_allowed`                                  |
| `POST /premium/subscribe`                          | `subscribePremium`                                           | 200 `Success`                          | 405 `method_not_allowed`                                                                                                   |
| `GET /users/all-settings`                          | `getAllSettings`                                             | 200 `LegacySettingsSnapshot`           | 405 `method_not_allowed`                                                                                                   |
| `PUT /users/all-settings`                          | `updateAllSettings`<br> `LegacySettingsBulkPatch`            | 200 `LegacySettingsBulkUpdateResult`   | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `GET /users/settings`                              | `getSettings`                                                | 200 `SettingsResponse`                 | 405 `method_not_allowed`                                                                                                   |
| `PUT /users/settings`                              | `updateSettings`<br> `MvpSettings`                           | 200 `SettingsUpdateResponse`           | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `PUT /users/privacy`                               | `updatePrivacy`<br> `PrivacySettingsPatch`                   | 200 `PrivacyUpdateResponse`            | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `GET /users/privacy/exceptions`                    | `listPrivacyExceptions`                                      | 200 `PrivacyExceptionsResponse`        | 400 `validation_failed`; 405 `method_not_allowed`                                                                          |
| `PUT /users/privacy/exceptions/{rule}/{userId}`    | `setPrivacyException`<br> `PrivacyExceptionRequest`          | 200 `PrivacyExceptionResponse`         | 400 `invalid_json / validation_failed / self_exception`; 404 `user_not_found`; 405 `method_not_allowed`                    |
| `DELETE /users/privacy/exceptions/{rule}/{userId}` | `removePrivacyException`                                     | 200 `Success`                          | 400 `validation_failed`; 405 `method_not_allowed`                                                                          |
| `GET /users/notifications`                         | `getNotifications`                                           | 200 `LegacyNotificationResponse`       | 405 `method_not_allowed`                                                                                                   |
| `PUT /users/notifications`                         | `updateNotifications`<br> `LegacyNotificationSettings`       | 200 `LegacyNotificationUpdateResponse` | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `GET /users/sounds`                                | `getSounds`                                                  | 200 `LegacySoundResponse`              | 405 `method_not_allowed`                                                                                                   |
| `PUT /users/sounds`                                | `updateSounds`<br> `LegacySoundSettings`                     | 200 `LegacySoundUpdateResponse`        | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `GET /users/advanced-settings`                     | `getAdvancedSettings`                                        | 200 `LegacyAdvancedResponse`           | 405 `method_not_allowed`                                                                                                   |
| `PUT /users/advanced-settings`                     | `updateAdvancedSettings`<br> `LegacyAdvancedSettings`        | 200 `LegacyAdvancedUpdateResponse`     | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `GET /users/folders`                               | `listFolders`                                                | 200 `LegacyFoldersResponse`            | 405 `method_not_allowed`                                                                                                   |
| `PUT /users/folders`                               | `updateFolders`<br> `LegacyFoldersRequest`                   | 200 `Success`                          | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                           |
| `GET /users/storage`                               | `getStorage`                                                 | 200 `StorageResponse`                  | 405 `method_not_allowed`                                                                                                      |
| `PUT /users/storage/settings`                      | `updateStorageSettings`<br> `LegacyStorageSettings`          | 200 `StorageSettingsUpdateResponse`    | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                              |
| `DELETE /users/storage/cache`                      | `clearStorageCache`                                          | 200 `Success`                          | 405 `method_not_allowed`                                                                                                      |
| `DELETE /users/storage/all`                        | `deleteAllUserData`                                          | 200 `Success`                          | 405 `method_not_allowed`                                                                                                      |
| `GET /users/export`                                | `exportUserData`                                             | 200 `UserExport`                       | 405 `method_not_allowed`                                                                                                   |
| `GET /users/blocked`                               | `listBlockedUsers`                                           | 200 `UserBlockedResponse`              | 405 `method_not_allowed`                                                                                                   |
| `POST /users/blocked`                              | `blockUser`<br> `BlockUserRequest`                           | 201 `Success`                          | 400 `invalid_json / validation_failed / self_block`; 404 `user_not_found`; 405 `method_not_allowed`; 409 `already_blocked` |
| `DELETE /users/blocked/{userId}`                   | `unblockUser`                                                | 200 `Success`                          | 400 `validation_failed`; 405 `method_not_allowed`                                                                          |
| `GET /users/passcode`                              | `getPasscodeState`                                           | 200 `PasscodeState`                    | 405 `method_not_allowed`                                                                                                      |
| `POST /users/passcode/set`                         | `setPasscode`<br> `SetPasscodeRequest`                       | 200 `Success`                          | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                              |
| `POST /users/passcode/verify`                      | `verifyPasscode`<br> `PasscodeRequest`                       | 200 `Success`                          | 400 `invalid_json / no_passcode_set`; 405 `method_not_allowed`                                                                |
| `POST /users/passcode/disable`                     | `disablePasscode`<br> `PasscodeRequest`                      | 200 `Success`                          | 400 `invalid_json / no_passcode_set`; 405 `method_not_allowed`                                                                |
| `PUT /users/passcode/timeout`                      | `updatePasscodeTimeout`<br> `PasscodeTimeoutRequest`         | 200 `Success`                          | 400 `invalid_json / validation_failed`; 405 `method_not_allowed`                                                              |
| `GET /users/devices`                               | `listDevices`                                                | 200 `DevicesResponse`                  | 405 `method_not_allowed`                                                                                                   |
| `POST /users/devices/register`                     | `registerDevice`<br> `DeviceRegistrationRequest`             | 200 `DeviceRegistrationResponse`       | 400 `invalid_json`; 405 `method_not_allowed`                                                                               |
| `GET /users/push/vapid-key`                        | `getPushVapidKey`                                            | 200 `PushVapidResponse`                | 404 `push_not_configured`; 405 `method_not_allowed`                                                                        |
| `POST /users/push/subscriptions`                   | `savePushSubscription`<br> `PushSubscriptionRequest`         | 200 `PushSubscriptionResponse`         | 400 `invalid_json / invalid_push_subscription`; 405 `method_not_allowed`                                                   |
| `DELETE /users/push/subscriptions`                 | `deletePushSubscription`<br> `DeletePushSubscriptionRequest` | 204 `без тела`                         | 400 `invalid_json`; 405 `method_not_allowed`                                                                               |
| `POST /users/devices/terminate-all`                | `terminateAllDevices`                                        | 200 `Success`                          | 405 `method_not_allowed`                                                                                                   |
| `DELETE /users/devices/{sessionId}`                | `deleteDevice`                                               | 200 `Success`                          | 400 `invalid_request / validation_failed`; 404 `not_found`; 405 `method_not_allowed`; 409 `conflict_current_session`       |

## Изменения контракта и оставшаяся реализация

| Задача              | Состояние и оставшаяся работа после #495                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| #495                | Реализована validation всех object sections до SQL, closed keys/enums/ranges/null и безопасные legacy reads   |
| #451 / #497 / #1040 | Defaults и avatarShape готовы в #451; полный Appearance и совместимость fontSize/HEX завершены в #1040   |
| #728 / #1041        | Применение Appearance, точные CSS metrics/visual tests, system media query, sync между устройствами/вкладками |
| #1042 / #725        | Серверные aliases/migration/push silent готовы в #1042; browser fallback/ringtone остаются #725    |
| #1047               | Реализованы общий locked mutation path bulk/section и PostgreSQL concurrency/rollback regression tests            |
| #435 / #441         | Empty list вместо legacy null; обязательный dedicated folders input без непреднамеренной очистки              |
| #442 / #449 / #450  | Timeout=0/invalid input, неправильные методы, один JSON root                                                  |
| #445 / #446         | Настоящий storage accounting и cache clear                                                                    |
| #447 / #448         | Реализация согласованного расширенного export/delete scope и последующее расширение DTO                       |
| #452                | Trusted public origin для canonical profile QR; проверить frontend landing route                              |

Стандартизация двух PostgreSQL timestamps и платный billing flow — отдельные обнаруженные пробелы, а не выполненные изменения этого PR. Уже исправленные #432–#440/#443/#444/#706 повторно не считаются остатком: текущие schemas учитывают их результат.

## Проверка и изменение схем

`frontend/src/types/userApiContract.node.test.ts` компилирует все request/success/error schemas и проверяет fixtures допустимых/недопустимых partial settings, bulk/null, диапазонов, privacy aliases, обязательных profile fields, коллекций и timestamps. `satisfies` fixtures также проверяются отдельным TypeScript вызовом. Эти проверки проверяют **выбранный контракт**. Go tests settings_validation_test.go и settings_validation_integration_test.go дополнительно проверяют HTTP handlers на настоящем PostgreSQL: no-SQL rejection, round-trip, false/0, bulk no-op, readonly passcode, corrupt reads и атомарность UPDATE при ошибке БД. Auth middleware в этих HTTP fixtures заменяется фиксированным владельцем; browser UI в #495 не меняется.

Byte-limit passcode выражен расширением `x-min-trimmed-utf8-bytes`; contract validator регистрирует этот keyword. Обычный JSON Schema validator без поддержки расширения проверит тип строки, но не этот byte-limit. Проверки decoded push keys/host allowlist остаются в Go validator и его тестах.

```bash
cd frontend
npm run api:types
npm run api:check
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target es2023 --moduleResolution bundler --module esnext src/types/userApiContract.node.test.ts
```

При изменении wire format одновременно обновлять YAML, fixtures, документацию runtime gaps и generated types. CI заново генерирует types и проверяет отсутствие diff; изменение OpenAPI запускает frontend contract checks. Отдельный Go conformance test нужен в каждой реализации перечисленных backend задач, иначе наличие описанного `400` не доказывает его работу.
