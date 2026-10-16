# Источник правды уведомлений и звуков

Решение USER-D003, #496. Дата: 16 октября 2026. Продолжает [выбор Settings API](settings-api.md), #498. Реализация серверной нормализации/совместимости — #1042; применение в клиентских consumers — #725. Этот документ определяет контракт, а не подтверждает готовность этих реализаций.

## Каноническая модель MVP

Единственный account-wide источник трёх намерений — поля `users.settings.settings`, читаемые через `GET /api/v2/users/settings` и изменяемые flat patch через `PUT /api/v2/users/settings`.

| Поле            | Тип / default    | Пользовательский смысл                                                                |
| --------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `notifications` | boolean / `true` | Общий допуск автоматических оповещений о сообщениях и звонках на устройствах аккаунта |
| `sounds`        | boolean / `true` | Предпочтение звука входящего сообщения; не управляет звуком звонка                    |
| `callSounds`    | boolean / `true` | Предпочтение рингтона входящего аудио/видеозвонка; не управляет звуком разговора      |

Эти booleans сохраняются как самостоятельные поля, не вычисляются из подробных legacy-объектов при каждом чтении и не удаляются. Все три — предпочтения пользователя; effective result вычисляется отдельно с учётом контекста. Новый клиент не читает `notification_settings`/`sound_settings` как второй набор глобальных выключателей.

**Подробные параметры:** для MVP не вводим новые account-wide переключатели групп/каналов/громкости/выбора мелодий. Подробные значения остаются в прежних колонках как compatibility data для старых клиентов, с явно перечисленными ниже alias-полями. Они не становятся скрытыми фильтрами современного клиента или server push. Если появится полноценный редактор подробных параметров, его типизированный canonical contract и миграция определяются отдельной задачей; существование JSONB-поля не включает функцию в MVP автоматически.

Предпочтения конкретного чата — самостоятельный chat resource: personal mute #559 и `hideNotificationPreview` #560. Browser permission, push subscription/видимость приложения и громкость голосовых — состояние устройства. Сохранённые `notifications=true` не создают подписку, не дают разрешение браузера и не обходят privacy/blocklist.

## Приоритет и обратное включение

1. Сначала проверяются допустимость события/получателя, privacy/blocklist и принадлежность чату. Запрещённый звонок не создаёт alert.
2. `notifications=false` подавляет новые автоматические OS/push/in-app оповещения, звук сообщения и рингтон, но не realtime-доставку сообщения/звонкового состояния, unread, read receipts и звук уже идущего разговора.
3. `sounds` и `callSounds` независимы. Их выключение не меняет `notifications` или соседний sound flag.
4. Personal chat mute подавляет оповещения и звуки новых сообщений этого чата. В MVP он не запрещает звонки и не выключает их рингтон; входящий вызов ограничивается privacy `calls` и общими flags. Для mute звонков конкретного чата понадобится отдельное явно названное требование.
5. Видимость приложения, активный чат и разрешение браузера выбирают допустимый канал доставки. Server push не отправляется видимой подписке; открытый активный чат не получает дубль сообщения по правилу #725. При активном push fallback Notification вкладки не дублирует его.

Выключение `notifications` меняет только этот boolean: не сбрасывает `sounds/callSounds`, legacy details, personal mute, preview, permission или subscription. После включения используются прежние предпочтения. Аналогично выключение/включение одного sound flag не меняет соседние параметры. Пропущенные за время запрета оповещения не воспроизводятся задним числом.

### Матрица effective policy

Здесь `N/S/C` — `notifications/sounds/callSounds`; `M` — personal mute сообщений. Дополнительно действуют условия privacy, канала доставки и активного чата.

| Настройки                        | Оповещение сообщения | Звук сообщения | OS-оповещение звонка | Рингтон в открытом приложении |
| -------------------------------- | -------------------- | -------------- | -------------------- | ----------------------------- |
| N=false, любые S/C/M             | Нет                  | Нет            | Нет                  | Нет                           |
| N=true, S=true, C=true, M=false  | Да                   | Да             | Да                   | Да                            |
| N=true, S=false, C=true, M=false | Да, тихо             | Нет            | Да                   | Да                            |
| N=true, S=true, C=false, M=false | Да                   | Да             | Да, тихо             | Нет                           |
| N=true, любые S/C, M=true        | Нет                  | Нет            | Да, звук по C        | По C                          |

`silent` OS-уведомления следует S для message и C для call. Пропущенный звонок — тихое обновление, без повторного рингтона; N=false также запрещает новое missed-call notification. Звук ОС и вибрация зависят от возможностей браузера/системы: запрещённый звук нельзя обходить отдельным Web Audio или vibration. При доставке push итоговый признак `silent` должен быть передан сервером без текста E2E-сообщения и применён service worker (#1042/#725); текущий payload его ещё не содержит. Изменение payload должно быть совместимо со старым service worker и его обновлением.

Preview — отдельное решение от допуска/звука. Server push по-прежнему не содержит plaintext; fallback вкладки может показать текст только после безопасного decrypt и проверки chat preview policy. Ошибка чтения preview означает безопасный текст «Новое сообщение». `showMessageStatus` — оформление, не управление read receipts.

## Legacy mapping и конфликты

Для всех оставленных read/write routes действует один resolver в #1042. После его включения legacy GET и bulk GET проецируют alias-поля из канонических значений; отдельные сохранённые alias-копии не становятся источником правды. Старые response envelopes и имена полей сохраняются по #498. Данные без эквивалента не копируются в общий settings произвольными keys.

| Legacy поле                                                          | Решение                                                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soundSettings.messagesSound`                                        | Alias `settings.sounds` после миграции                                                                                                                               |
| `soundSettings.notificationsSound`                                   | Старый общий звуковой gate уведомлений: при первичной миграции участвует в fallback для sounds; после перехода compatibility alias звука сообщений `settings.sounds` |
| `soundSettings.callsSound`                                           | Alias `settings.callSounds`; не писать ни в sounds, ни в notifications                                                                                               |
| `notificationSettings.privateChats/groups/channels/calls/videoCalls` | Категорийные legacy preferences без эквивалента в MVP; хранить для compatibility. Не превращать один выключенный тип чата в global notifications=false               |
| `notificationSettings.inAppNotifications`                            | Legacy in-app flag, не эквивалент browser/push master notifications; сохранять отдельно                                                                              |
| `notificationSettings.messagePreview`                                | Legacy account-wide preview; не переносить поверх персонального chat preview и не раскрывать plaintext в push                                                        |
| `notificationSettings.readReceipts`                                  | Не notification preference современного клиента; не отключает реальную отправку receipts и не равен showMessageStatus                                                |
| `notificationSettings.reactions/newContacts`                         | Compatibility-only event preferences, соответствующих MVP alerts нет                                                                                                 |
| `soundSettings.notificationsVolume/mediaVolume`                      | Compatibility-only volume; не переносить в device-local громкость голосовых                                                                                          |
| `soundSettings.sendSound/vibrateOnCall`                              | Compatibility-only preferences; не добавляют send sound/vibration feature в MVP. При запрещённом оповещении вибрацией обходить запрет нельзя                         |
| `soundSettings.notificationSound/messageSound/ringtone`              | Compatibility-only выбор мелодий; не менять формат/активный renderer рингтона автоматически                                                                          |

### Первичная нормализация существующих записей

Нормализация выполняется **один раз**, под версией миграции/модели. Она не повторяется при GET, refetch, reconnect или повторном backfill. #1042 определяет техническое хранение marker и транзакцию; marker не является редактируемой пользовательской настройкой.

1. Валидный явно сохранённый canonical boolean имеет приоритет, включая `false`. Например, `settings.sounds=true` и legacy `messagesSound=false` дают canonical true: сохраняем текущий выбор современного приложения; legacy alias после перехода отражает его. При конфликте нельзя угадывать давность по одному общему updated_at строки.
2. Если canonical `sounds` отсутствует, взять conjunction legacy `messagesSound` и `notificationsSound`: отсутствующий legacy operand считается true, любой валидный false запрещает звук. Это сохраняет отключение старого звукового gate без двух активных master flags.
3. Если `callSounds` отсутствует, взять legacy `callsSound`, иначе true. `sounds` не используется как fallback для callSounds.
4. Если `notifications` отсутствует, применить default true. Частичные per-category/in-app flags не являются global master и не подменяют его.
5. Если canonical ключ присутствует с неверным типом или null, нормализовать его в false, а не включать через legacy/default. Невалидный присутствующий legacy sound operand также даёт false. Новые неверные записи после включения #495 отвергаются, а не нормализуются молча.
6. Не трогать theme/language/privacy/chat preferences/subscriptions. Сохранить исходные compatibility-only значения; потерю исходных конфликтующих alias-значений учитывать в проверяемом rollback/резервном плане миграции, без их логирования вместе с персональными данными.

Примеры: отсутствие всех трёх flags и пустые legacy objects → true/true/true; sounds отсутствует и messagesSound=false → sounds=false; callSounds отсутствует и callsSound=false → callSounds=false; canonical sounds=false с legacy true → false. После canonical sounds=true повторный backfill не возвращает старое legacy false.

### Запись после включения resolver

- Canonical PUT меняет только переданные N/S/C и разрешённые общие поля; отсутствие флага не сбрасывает его. Возвращает итоговый settings. Generic schema остальных полей уточняется в #453.
- Legacy section PUT `messagesSound` или `notificationsSound` меняет canonical sounds, `callsSound` — canonical callSounds. Compatibility-only keys сохраняются в соответствующей legacy колонке и не меняют N/S/C. Notification section PUT не имеет alias для global notifications.
- Bulk #454: если одновременно передан canonical boolean и его валидные legacy aliases, побеждает canonical, включая false. Если canonical не передан, равные aliases задают значение, конфликтующие `messagesSound`/`notificationsSound` дают `400 validation_failed` без записи. Например, один legacy alias true при другом отсутствующем — patch true, не повторный conjunction со старым состоянием.
- Весь запрос валидируется до записи, включая проигравшие по приоритету aliases; неверный тип не игнорируется. Неподдерживаемые keys/null обрабатываются по общей schema #495. Запись canonical + legacy части запроса и marker должна быть атомарна; конкурентность bulk остаётся #454.
- Canonical и legacy GET после перехода читают resolver: alias-поля отражают canonical flags. Compatibility details возвращаются прежними keys; схемы wrappers и поля без эквивалента не меняются самовольно.

До внедрения #1042 legacy endpoints продолжают прежнее поведение. Ни изменение OpenAPI, ни этот документ сами по себе не включают resolver/проекции/миграцию. После rollout запрещено одновременно держать старых server writers, пишущих aliases в обход resolver, и новых consumers.

## Rollout и обязанности задач

1. **#496:** принять модель, отразить shared schema трёх flags в OpenAPI и frontend type; сохранить существующий default/fallback отсутствующего callSounds. Документировать модель для canonical, legacy и bulk операций.
2. **#453/#451/#495:** закрепить полный typed contract, defaults и validation. **[#454](settings-bulk-api.md):** partial bulk envelope, read-only поля и конкурентная запись; runtime safe mutation path — #1047, aliases — #1042.
3. **#1042:** реализовать общий resolver, первичную нормализацию/marker, compatibility adapters и alias-проекции, server delivery policy и совместимое расширение push payload для silent; проверить rollback/repeatability на реальной БД. Уже существующую задачу использовать, новую migration issue не создавать.
4. **#725:** применять ту же effective policy в browser fallback, звуке сообщения, рингтоне и service worker. Query cache — клиентское представление серверных настроек; profileStore/localStorage не должен независимо переопределять подтверждённый серверный выбор. Убрать временные fallback-пути при внедрении политики, сохранив корректный старт до загрузки настроек.
5. Server-фильтрация notifications уже есть, но новое поведение всех flags выпускать согласованно с клиентом/worker, проверив cache versioning, permission, duplicate suppression и старые подписки. Отказ новых settings-read не должен разрешать отключённые ранее оповещения; повторная попытка и сохранённое подтверждённое состояние описываются в #725/#1041.

## Что подтверждено сейчас

- Регистрация создаёт settings.notifications/sounds и параллельные подробные objects; callSounds серверным default пока не задан.
- `push.DBDirectory.Targets` читает settings.notifications. Browser NotificationManager этот флаг пока не применяет.
- UI сохраняет три canonical flags через общий PUT, callStore читает callSounds; sounds=false не отключает рингтон.
- Рингтон пока не маскируется global notifications; profileStore fallback callSounds пока существует. Это остаток #725, не новая конкурирующая серверная модель.
- Service worker пока не получает sound policy, legacy writes не обновляют canonical flags. Это остаток #1042/#725.

Источники: `backend-v2/internal/auth/service.go`, `internal/user/{handler,service}.go`, `internal/push/{directory,notifier}.go`; frontend `pages/settings/ui/sections/NotificationsSection.tsx`, `entities/user/model/{types,defaultProfileSettings}.ts`, `features/call/model/useCallSounds.ts`, `app/providers/NotificationManager.tsx`, `frontend/pwa/sw.js`.
