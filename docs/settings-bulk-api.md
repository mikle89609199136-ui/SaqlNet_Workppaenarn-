# Bulk Settings API: частичное обновление

Решение USER-D002, #454. Основание: `user.AllSettings`, `UpdateAllSettings`, `Handler.AllSettings`, legacy `scripts/theme.js`, [канонический API](settings-api.md) (#498) и [notification/sound mapping](notification-settings.md) (#496).

## Решение и границы

`GET/PUT /api/v2/users/all-settings` остаётся **deprecated compatibility API**. PUT означает частичное bulk-обновление указанных разделов, а не полную замену аккаунтных настроек. Method/path/operationId сохраняются, summary `Replace all settings` заменяется точным описанием. Новый React-клиент использует канонические routes из #498.

Ответ PUT сохраняется: `200 { "success": true }`. Итоговый snapshot получается отдельным GET; в PUT response не добавляются новые обязательные поля или новый envelope. Пара GET/PUT не является compare-and-swap, экспортом/импортом всего аккаунта или атомарной последовательностью запросов.

Это задача на решение и контракт. Ни спецификация, ни generated types не исправляют текущую конкурентную запись. Внедрение безопасной мутации выполняется backend-задачей #1047; validation/defaults/resolver имеют собственных владельцев ниже.

## GET: полный совместимый snapshot

Владелец определяется сессией, query/body userId не выбирает другого пользователя. Ответ 200 — объект с девятью полями верхнего уровня:

| Поле                                     | Содержимое                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `settings`                               | Общие настройки, включая canonical notifications/sounds/callSounds по #496                                          |
| `privacySettings`                        | Нормализованные базовые privacy rules; в canonical GET поле называется privacy                                      |
| `notificationSettings` / `soundSettings` | Legacy detailed objects; после #1042 sound aliases проецируются из canonical flags                                  |
| `storageSettings` / `advancedSettings`   | Compatibility-only objects, не новые настройки MVP                                                                  |
| `folders`                                | Массив legacy folders; текущий GET может вернуть null из сохранённого JSON null, нормализация в [] относится к #451 |
| `passcodeEnabled` / `passcodeTimeout`    | Read-only сведения о passcode, не обновляемые этим PUT                                                              |

Ключи snapshot обязательны, состав preference objects может быть неполным до единых defaults #451. [#453 фиксирует typed leaf schemas](user-api-contract.md); folders намеренно остаются opaque legacy JSON без обещания новой MVP-модели. Privacy exceptions, blocklist, push subscriptions, session/device state и key backup в snapshot не входят.

## PUT: обязательность и правила по полям

Тело обязательно: один JSON object. Ни одного обязательного writable-раздела нет; `{}` разрешён и не запрашивает сброс. Внутри операции не меняется смысл канонического flat patch: bulk оборачивает его именем раздела.

| Переданное значение                                    | Результат                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Раздел отсутствует                                     | Сохранить весь раздел                                                   |
| Любой из шести preference-разделов — object            | Shallow merge его keys; omitted keys сохраняются                        |
| Preference-раздел — `{}`                               | Сохранить текущие значения                                              |
| Preference-раздел — `null`                             | Совместимый no-op для всего раздела, как сейчас; не команда удаления    |
| `folders` отсутствует или null                         | Сохранить текущий массив                                                |
| `folders: []`                                          | Явно очистить список folders                                            |
| `folders: [ ... ]`                                     | Заменить список целиком, не merge по индексу или ID                     |
| `passcodeEnabled` / `passcodeTimeout` корректного типа | Принять для совместимости snapshot round-trip и игнорировать при записи |

Шесть preference-разделов: settings, privacySettings, notificationSettings, soundSettings, storageSettings, advancedSettings. **Различать null раздела и null leaf:** например, `{ "privacySettings": null }` — no-op, `{ "privacySettings": { "calls": null } }` — недопустимое значение privacy. Для остальных typed leaf values также действует запрет null из #498/#495. Nested object, если разрешён своей схемой, заменяется целиком; рекурсивного merge нет. Правила null разделов относятся только к этому legacy bulk envelope.

Неверный shape (раздел-массив/строка, folders-object), неизвестный root key или недопустимое leaf-значение должны отвергаться целиком до записи согласно #495. Корневой JSON null/array/scalar не является patch object. Текущий decoder ещё игнорирует unknown root keys и принимает root null как пустую структуру; это документированный runtime gap, не поддерживаемая команда сброса. Strict root validation внедряется в #495; изменения публикуются совместимо по #498.

### Passcode

Bulk никогда не включает/отключает passcode, не устанавливает secret и не меняет timeout. Поля разрешены только как ignored compatibility input; в GET они read-only. Нельзя выводить «passcode изменён» из success bulk-запроса или записывать их в общий JSON settings. Изменение passcode имеет отдельный `/users/passcode` contract, включая дефект timeout #442; эта функция не добавляется в MVP настройками bulk.

### Пример

```json
{
  "settings": { "theme": "light", "notifications": false },
  "privacySettings": { "calls": "nobody" },
  "folders": []
}
```

Меняются только два перечисленных раздела и массив folders. Sounds/callSounds, прочие privacy rules, compatibility objects и passcode остаются прежними. Скрытие уведомлений маскирует звуки по #496, а не сбрасывает их сохранённые предпочтения.

## Notification/sound aliases в bulk

После внедрения resolver #1042 применяется уже принятое решение #496:

- Валидные переданные `settings.sounds/callSounds` имеют приоритет над соответствующими aliases в soundSettings; явный false сохраняется.
- Если canonical flag отсутствует, переданный messagesSound или notificationsSound задаёт sounds, callsSound — callSounds. Отсутствующий alias не подмешивается из прежнего snapshot.
- Без canonical sounds конфликт двух переданных aliases messagesSound/notificationsSound — `400 validation_failed`, весь запрос отклоняется.
- Типы проигравших по приоритету aliases тоже валидируются; invalid input не маскируется приоритетом.
- Alias-проекции и compatibility-only данные обновляются одной атомарной операцией с canonical fields. GET после перехода показывает разрешённые resolver значения, а не независимые копии глобальных flags.

До rollout #1042 bulk пока сохраняет независимые JSONB objects. #454 не объявляет runtime alias mapping реализованным.

## Атомарность и конкурентные запросы

Одна bulk-операция либо сохраняет все допустимые writable-изменения, либо не сохраняет ни одного. Validation должна закончиться до записи. Недопустим partial success с частью обновлённых разделов или HTTP 200 после ошибки БД.

Выбранный способ реализации: общий транзакционный mutation path для bulk и section read-modify-write. Создание отсутствующей строки входит в транзакцию; текущее состояние читается под `SELECT ... FOR UPDATE`, затем patch/resolver вычисляются из **заблокированного актуального** состояния, выполняется UPDATE и commit. Сначала прочитать snapshot без блокировки, затем заблокировать только UPDATE — недостаточно.

Canonical SQL updates, которые уже меняют только переданные keys, сериализуются row lock PostgreSQL. Каждый writer, читающий JSON в приложение и записывающий его обратно (`UpdateAllSettings`, `UpdatePreference` и будущий resolver), обязан использовать тот же порядок блокировки. Нельзя исправить только bulk, оставив stale section writer. Внутри tx используются tx-методы; нельзя повторно вызывать Service.AllSettings на отдельном connection и ожидать своей блокировки.

- Параллельные patches разных keys/разделов сохраняют оба изменения независимо от порядка завершения.
- Для одного и того же key или двух замен folders применяется последнее сериализованное изменение; время клика/сетевого ответа не задаёт порядок БД.
- Read-only passcode не попадает в UPDATE и не откатывает параллельное изменение через собственный endpoint.
- Новые обязательные revision/If-Match и конфликт 409 для bulk не вводятся. Optimistic concurrency можно добавить отдельным контрактом, если понадобится редактирование snapshot.
- Ответ success отправляется после commit. При использовании settings events (#1041) failed/no-op mutation не должна выдавать ложное событие; правило публикации после commit согласуется с транспортом #1041.

Текущий код читает snapshot без блокировки и перезаписывает все разделы, а UpdatePreference делает собственный read-modify-write. Эта гарантия **ещё не реализована**; её проверяет отдельная backend implementation-задача. Даже атомарный SQL UPDATE нескольких колонок сам по себе не защищает от stale snapshot.

## Ошибки и проверяемый round-trip

Общие cookie/Origin/auth/errors правила — #498. Неверный JSON даёт 400 invalid_json; domain validation — 400 validation_failed. Сегодня часть shape/type ошибок также попадает в invalid_json из decoder, unknown keys/root null не отвергаются; error matrix/validation выравниваются в #453/#495. Неверный passcode input не изменяет passcode; тип проверяется несмотря на read-only семантику. Не вводим новый reset endpoint, PATCH или другой URL.

Round-trip для compatibility-клиента:

1. GET возвращает snapshot и read-only сведения.
2. Клиент собирает **patch изменённых keys**, а не отправляет назад весь старый snapshot. Совместимый полный snapshot принимается, но его writable keys считаются явно переданными и могут перезаписать более новые значения.
3. PUT возвращает только success после записи; read-only passcode значения игнорируются.
4. Следующий GET подтверждает значения с нормализацией/aliases/defaults. Если между запросами прошла другая запись, GET может показать её более новое состояние; это не обещание snapshot isolation между HTTP-запросами.

## Владельцы реализации и приёмка

- [#1047](https://github.com/mikle89609199136-ui/CraneApp/issues/1047) (USER-B023): общий safe mutation path и защита bulk/section от потери изменений; создана в Product Backlog, Component Backend.
- #495 — typed validation всех сохраняемых sections, root unknown keys и null/shape policy; #453 — точные leaf schemas, errors и DTO; #451 — единые defaults/normalization чтения.
- #1042 — notification/sound resolver и миграция; #1040 — Appearance; #1041 — доставка изменений. Эти задачи используют решение #454, не заменяют его конкурентные regression cases.

Приёмка backend-реализации: barriers/две DB connections для воспроизводимой гонки bulk против canonical settings/privacy/preference; сохранение disjoint keys; два folders replacement в определённом порядке; rollback на invalid mixed patch/ошибке БД; no-op/omitted/null/empty semantics; неизменность passcode; alias priority/error cases из #496 и совместимые responses. Проверять на настоящем PostgreSQL, а не только SQL mock. Production data в #454 не изменяются.
