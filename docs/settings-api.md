# Канонический Settings API

Решение USER-D004, #498. Дата: 16 октября 2026. Основание: маршруты `backend-v2/cmd/user/main.go`, handlers/services User API, вызовы React и замороженного `legacy/mobile-client`, [аудит настроек](audits/settings-audit-2026-10-16.md).

## Решение

Для настроек аккаунта в MVP поддерживаем один способ чтения и два разделённых способа частичного изменения. Префикс всех адресов — `/api/v2`.

| Метод и адрес         | Назначение                                    | Тело запроса / ответ 200                                                                         |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /users/settings` | Настройки и приватность текущего пользователя | Ответ `{ "settings": { ... }, "privacy": { ... } }`                                              |
| `PUT /users/settings` | Частично изменить общие предпочтения          | Flat patch, например `{ "theme": "light" }`; ответ `{ "settings": { ... } }` с итоговым разделом |
| `PUT /users/privacy`  | Частично изменить базовые правила приватности | Flat patch, например `{ "calls": "nobody" }`; ответ `{ "privacy": { ... } }` с итоговым разделом |

`GET /users/privacy` не вводится: приватность читается вместе с настройками. Пользователь определяется сессией; поля userId для выбора владельца нет. UI-разделы «Оформление», «Язык», «Уведомления» не требуют отдельных endpoints только из-за разных экранов.

Исключения приватности остаются отдельными ресурсами: `GET /users/privacy/exceptions[?rule=…]`, `PUT/DELETE /users/privacy/exceptions/{rule}/{userId}`. Чёрный список — `/users/blocked`. Изменение базового правила не заменяет исключения и не снимает блокировки.

Источник notification/sound определён в [решении #496](notification-settings.md): канонические `notifications/sounds/callSounds` остаются в общем settings; sound aliases нормализуются в #1042. Подробные поля без эквивалента сохраняются как compatibility data. Канонические маршруты сохраняются, runtime adapter и миграция выпускаются совместимо. Детальные legacy endpoints не становятся независимым источником глобальных preferences.

## Единые правила

- **Auth:** все канонические и сохраняемые legacy-маршруты требуют сессию. Browser credentials — HttpOnly cookie по `sessionCookie` OpenAPI (#705). Изменение с cookie требует собственного или точно разрешённого `Origin`; авторизация не переносится в тело или URL.
- **Запись:** `Content-Type: application/json`; только изменённые поля раздела, без оболочки `settings`/`privacy`. Отсутствующее поле сохраняет прежнее значение. Пустой объект не запрашивает сброс. Это shallow update верхнего уровня, а не рекурсивный merge и не RFC JSON Merge Patch. Вложенный объект, если будет допущен схемой, заменяется целиком.
- **Ответ:** обычный PUT возвращает соответствующий итоговый раздел. Frontend сохраняет канонический GET payload в query cache и после изменения перечитывает его. Bulk ответ `{ "success": true }` не является ответом канонического PUT. [Решение #454](settings-bulk-api.md) сохраняет этот acknowledgement и задаёт отдельный legacy envelope.
- **Validation — реализована в #495:** известные ключи, типы, enums/ranges; неизвестный ключ, неверный тип и `null` вместо значения дают `400 validation_failed` до любого SQL. `null` не используется как команда удаления/сброса. Поля определены в #453/#496; те же проверки действуют для соответствующих bulk/section writes. Legacy general section дополнительно принимает только известные aliases accentColor/fontSize по #453.
- **Defaults — реализованы в #451:** [единый источник](settings-defaults.md) для регистрации, восстановления и всех способов чтения. Недостающие поля дополняются в ответах, сохранённые значения не сбрасываются. Проекция defaults не попадает в partial patch; [Appearance compatibility реализована в #1040](appearance-settings.md), notification aliases остаются #1042.
- **Конкурентность:** patch разных полей не должен терять соседние изменения. Canonical SQL merge и общий locked mutation path bulk/preferences сохраняют параллельные изменения разных keys (#1047). Семантика и PostgreSQL regression tests описаны в [bulk contract](settings-bulk-api.md); стратегия синхронизации устройств/вкладок остаётся #1041. Атомарности нескольких разных HTTP-запросов не обещаем.

Privacy validation уже действует при `PUT /users/privacy` и записи privacy через bulk. В #495 остальные sections проходят typed DTO validation в service до SQL; handlers возвращают 400 validation_failed для неверных root/leaf/keys/types/ranges. [Полный контракт #453](user-api-contract.md) описывает также безопасную нормализацию повреждённых legacy reads. Единые defaults реализованы в [#451](settings-defaults.md); серверная совместимость Appearance завершена в [#1040](appearance-settings.md); notification migration и применение в UI остаются #1042/#728.

### Ошибки канонических маршрутов

Ошибки используют общий JSON envelope `code`, `message`, `requestId` из `httpx.ErrorJSON`; клиент ориентируется на `code`, а не текст message. Middleware может вернуть отказ до входа в handler.

| HTTP | Код / смысл                                               | Состояние                                                |
| ---- | --------------------------------------------------------- | -------------------------------------------------------- |
| 400  | `invalid_json` — тело не удалось декодировать             | Есть сейчас                                              |
| 400  | `validation_failed` — недопустимые поля/значения          | Privacy и остальные object sections проверяются до SQL (#495) |
| 401  | `missing_token`, `invalid_token`, `token_revoked`         | Общая session middleware                                 |
| 403  | `cross_site_request` — запрещённый Origin записи с cookie | Общая Origin-защита                                      |
| 405  | `method_not_allowed`                                      | Settings/privacy handlers                                |
| 500  | `internal_error` — чтение/запись не выполнены             | User handlers                                            |
| 503  | `auth_check_unavailable`, `crypto_protocol_not_ready`     | Проверка доступа недоступна; запрос не доходит до записи |

Полная матрица gateway limits и ошибок всех User API относится к #453. Нельзя переименовывать реальные backend codes только документацией. Unsupported methods в legacy storage handler сейчас дают 404, в других settings handlers — 405; выравнивание этих compatibility-отказов потребует отдельной реализации, если её решат делать до удаления routes.

## Судьба существующих маршрутов

`deprecated` означает сохранение текущей серверной совместимости без новых потребителей. Ни маршрут, ни данные в этой задаче не удаляются. Redirect или автоматическое превращение legacy body в canonical body не вводится: разделы и семантика отличаются.

| Метод и адрес                      | Решение                      | Путь перехода                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PUT /users/all-settings`      | Deprecated compatibility API | Для MVP читать `/users/settings`, писать только изменённый раздел через `/users/settings` или `/users/privacy`. Shallow bulk update по [#454](settings-bulk-api.md); passcode read-only, response success сохраняется |
| `GET/PUT /users/notifications`     | Deprecated compatibility API | Общие MVP-намерения — через `/users/settings`; mapping определён в [#496](notification-settings.md); runtime переход — #1042                                                                                          |
| `GET/PUT /users/sounds`            | Deprecated compatibility API | messagesSound/notificationsSound → sounds, callsSound → callSounds по [#496](notification-settings.md); runtime aliases — #1042                                                                                       |
| `GET/PUT /users/advanced-settings` | Deprecated compatibility API | Нового MVP editor нет. Сохранить legacy data; поддерживаемую замену определять вместе с будущей функцией                                                                                                              |
| `GET/PUT /users/folders`           | Deprecated compatibility API | Folders вне текущего MVP settings; не переносить их как произвольное поле в общий settings                                                                                                                            |
| `PUT /users/storage/settings`      | Deprecated compatibility API | Storage preferences вне MVP settings; не изобретать равнозначный canonical field без отдельного контракта                                                                                                             |

`GET /users/storage` остаётся отдельной операцией чтения usage; возвращаемая с usage legacy storage settings не является общим account settings. Операции cache/delete-all/export, профиль, сеансы, passcode, key backup и push subscriptions — самостоятельные API; #498 не меняет их поддержку. Политика уведомлений конкретного чата также остаётся chat resource (#559/#560), а не частью global settings.

### Миграция клиентов и условия удаления

1. **В #498:** пометить перечисленные операции `deprecated: true` в OpenAPI, сохранить paths/security/operationId; убрать из активного React `UserService` неиспользуемые методы detailed notification/sound/advanced/folder/storage-preference и их constants. React уже использует canonical settings/privacy, поэтому подменять его запросы не требуется. Сгенерировать frontend types из обновлённого контракта.
2. **Существующие legacy clients:** сервер продолжает обслуживать прежние bodies и responses; не вводить 404/410, redirects или смену response envelope. `legacy/mobile-client` остаётся замороженным справочником и не переписывается. Возобновление его поставки требует отдельного переноса настроек на canonical API.
3. **При переводе внешнего клиента:** прочитать общий settings/privacy через canonical GET; разбить bulk write на изменённые разделы. Не переносить поля неизвестного назначения и не обещать атомарность двух PUT. Если нужны detailed preferences, применить mapping [#496](notification-settings.md) после внедрения resolver #1042; для advanced/folders/storage оставить существующий compatibility маршрут до появления согласованной замены или снятия функции. Прямой перенос всех старых keys запрещён.
4. **До удаления routes:** проверить реальные обращения в production за согласованное окно (нулевых обращений по поиску в репозитории недостаточно), определить поддерживаемые версии клиентов, завершить миграцию данных и проверить, что оставленные bulk/section writers не обходят новую модель. Если используется deprecation telemetry, не логировать содержимое настроек/сессий.
5. **Удаление отдельным изменением:** после подтверждения перехода объявить версию прекращения поддержки и обновить клиентов, OpenAPI и tests вместе. Дата sunset сейчас не назначается; `Sunset`/`Deprecation` response headers сервером в #498 не добавляются. Наличие `deprecated` не означает, что такие headers уже отправляются.

## Границы следующих задач

| Задача             | Что решает после #498                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| #496               | Решение принято: [канонические поля, приоритеты и mapping](notification-settings.md); внедрение — #1042/#725 |
| #454               | [Bulk contract принят](settings-bulk-api.md); safe mutation path реализован в #1047, validation — #495                  |
| #453               | Типизированные keys/enums/ranges и полная status matrix User API, включая выбранные envelopes                |
| #451 / #497        | Единые defaults, avatarShape=letter и callSounds=true реализованы в #451; validation — #495                               |
| #1040 / #1042      | Appearance storage/compatibility готовы в #1040; notification migration остаётся #1042                                           |
| #1041              | Доставка изменений и применение между устройствами/вкладками                                                 |

Решение #498 считается реализованным при согласованности этой таблицы, OpenAPI и активного frontend service. Дальнейшая реализация runtime validation/migration остаётся в перечисленных задачах и не считается готовой от одной пометки deprecated.
