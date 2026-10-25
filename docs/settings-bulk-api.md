# Bulk Settings API: частичное обновление

Решение USER-D002, #454. Основание: `user.AllSettings`, `UpdateAllSettings`, `Handler.AllSettings`, legacy `scripts/theme.js`, [канонический API](settings-api.md) (#498) и [notification/sound mapping](notification-settings.md) (#496).

## Решение и границы

`GET/PUT /api/v2/users/all-settings` остаётся **deprecated compatibility API**. PUT означает частичное bulk-обновление указанных разделов, а не полную замену аккаунтных настроек. Method/path/operationId сохраняются, summary `Replace all settings` заменяется точным описанием. Новый React-клиент использует канонические routes из #498.

Ответ PUT сохраняется: `200 { "success": true }`. Итоговый snapshot получается отдельным GET; в PUT response не добавляются новые обязательные поля или новый envelope. Пара GET/PUT не является compare-and-swap, экспортом/импортом всего аккаунта или атомарной последовательностью запросов.

Контракт #454 реализован в части конкурентной записи задачей #1047: bulk и legacy section read-modify-write используют общую транзакцию с блокировкой строки. Validation/defaults/resolver имеют собственных владельцев ниже.

## GET: полный совместимый snapshot

Владелец определяется сессией, query/body userId не выбирает другого пользователя. Ответ 200 — объект с девятью полями верхнего уровня:

| Поле                                     | Содержимое                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `settings`                               | Общие настройки, включая canonical notifications/sounds/callSounds по #496                                          |
| `privacySettings`                        | Нормализованные базовые privacy rules; в canonical GET поле называется privacy                                      |
| `notificationSettings` / `soundSettings` | Legacy detailed objects; после #1042 sound aliases проецируются из canonical flags                                  |
| `storageSettings` / `advancedSettings`   | Compatibility-only objects, не новые настройки MVP                                                                  |
| `folders`                                | Массив legacy folders; GET нормализует сохранённый JSON null в [] после #451 |
| `passcodeEnabled` / `passcodeTimeout`    | Read-only сведения о passcode, не обновляемые этим PUT                                                              |

Ключи snapshot обязательны; после [#451](settings-defaults.md) preference objects дополняются едиными defaults при чтении, без backfill и без подмешивания в writable patch. [#453 фиксирует typed leaf schemas](user-api-contract.md); folders намеренно остаются opaque legacy JSON без обещания новой MVP-модели. Privacy exceptions, blocklist, push subscriptions, session/device state и key backup в snapshot не входят.

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

Resolver #1042 применяет решение #496:

- Валидные переданные `settings.sounds/callSounds` имеют приоритет над соответствующими aliases в soundSettings; явный false сохраняется.
- Если canonical flag отсутствует, переданный messagesSound или notificationsSound задаёт sounds, callsSound — callSounds. Отсутствующий alias не подмешивается из прежнего snapshot.
- Без canonical sounds конфликт двух переданных aliases messagesSound/notificationsSound — `400 validation_failed`, весь запрос отклоняется.
- Типы проигравших по приоритету aliases тоже валидируются; invalid input не маскируется приоритетом.
- Alias-проекции и compatibility-only данные обновляются одной атомарной операцией с canonical fields. GET после перехода показывает разрешённые resolver значения, а не независимые копии глобальных flags.

Resolver #1042 применяет указанные приоритеты до SQL и атомарно сохраняет canonical/compatibility части через locked mutation path. Legacy sound aliases возвращаются как проекции canonical flags; физические старые aliases не становятся вторым источником.

## Appearance aliases (#1040)

Переданный textSize приоритетен над переданным fontSize; иначе явный fontSize задаёт textSize независимо от предыдущего canonical/default значения. Все aliases валидируются до разрешения приоритетов. Bulk/export fontSize проецируется из разрешённого textSize. Arbitrary accentColor сохраняется без преобразования в preset. Полная policy и отсутствие глобального backfill — [Appearance compatibility](appearance-settings.md).

## Атомарность и конкурентные запросы

Одна bulk-операция либо сохраняет все допустимые writable-изменения, либо не сохраняет ни одного. Validation должна закончиться до записи. Недопустим partial success с частью обновлённых разделов или HTTP 200 после ошибки БД.

Выбранный способ реализации: общий транзакционный mutation path для bulk и section read-modify-write. Создание отсутствующей строки входит в транзакцию; текущее состояние читается под `SELECT ... FOR UPDATE`, затем patch/resolver вычисляются из **заблокированного актуального** состояния, выполняется UPDATE и commit. Сначала прочитать snapshot без блокировки, затем заблокировать только UPDATE — недостаточно.

Canonical SQL updates, которые уже меняют только переданные keys, сериализуются row lock PostgreSQL. Каждый writer, читающий JSON в приложение и записывающий его обратно (`UpdateAllSettings`, `UpdatePreference` и будущий resolver), обязан использовать тот же порядок блокировки. Нельзя исправить только bulk, оставив stale section writer. Внутри tx используются tx-методы; нельзя повторно вызывать Service.AllSettings на отдельном connection и ожидать своей блокировки.

- Параллельные patches разных keys/разделов сохраняют оба изменения независимо от порядка завершения.
- Для одного и того же key или двух замен folders применяется последнее сериализованное изменение; время клика/сетевого ответа не задаёт порядок БД.
- Read-only passcode не попадает в UPDATE и не откатывает параллельное изменение через собственный endpoint.
- Новые обязательные revision/If-Match и конфликт 409 для bulk не вводятся. Optimistic concurrency можно добавить отдельным контрактом, если понадобится редактирование snapshot.
- Ответ success отправляется после commit. AFTER UPDATE trigger #1041 публикует инвалидацию через PostgreSQL NOTIFY после commit; failed/no-op mutation ложного события не создаёт ([контракт](settings-sync.md)).

В #1047 `UpdateAllSettings` и `UpdatePreference` (включая storage) используют общий `mutateSettings` из `internal/user/settings_mutation.go`: BEGIN → INSERT ON CONFLICT → SELECT sections FOR UPDATE → sparse merge → UPDATE → COMMIT. Validation заканчивается до BEGIN. При ошибке UPDATE/COMMIT откатывается и создание отсутствующей строки; HTTP success возвращается только после commit. No-op bulk не открывает транзакцию.

Canonical settings/privacy и dedicated folders/passcode writers выполняют атомарные SQL UPDATE той же строки и сериализуются с этой блокировкой. Mutation читает только шесть JSON sections: старые повреждённые folders не мешают unrelated patch, omitted/null folders сохраняются физически. Passcode columns не входят в UPDATE. Defaults из #451 добавляются к ответам, но не становятся patch keys.

Проверки на настоящем PostgreSQL (`settings_mutation_integration_test.go`) используют удерживаемую транзакцию и `pg_blocking_pids` как барьер: writer обязан ждать на SELECT FOR UPDATE, затем увидеть предыдущее изменение. Проверены disjoint/same-key patches, оба порядка bulk/section writers, замена/очистка folders, параллельный passcode, ошибки UPDATE и deferred COMMIT, отмена ожидающего запроса. Публикация события после commit и его транспорт реализованы в [#1041](settings-sync.md); отдельный LISTEN integration test проверяет rollback/validation/no-op. Alias patch #1042 вычисляется из проверенного input до BEGIN, а его merge в canonical/compatibility состояние выполняется внутри этой же транзакции.

## Ошибки и проверяемый round-trip

Общие cookie/Origin/auth/errors правила — #498. После #495 неверный JSON даёт 400 invalid_json, а shape/type/null/unknown-key/domain errors — 400 validation_failed до любого SQL. Все sections, включая проигравшие по приоритету aliases, проверяются до записи. Неверный passcode input не изменяет passcode; тип проверяется несмотря на read-only семантику. Не вводим новый reset endpoint, PATCH или другой URL.

Round-trip для compatibility-клиента:

1. GET возвращает snapshot и read-only сведения.
2. Клиент собирает **patch изменённых keys**, а не отправляет назад весь старый snapshot. Совместимый полный snapshot принимается, но его writable keys считаются явно переданными и могут перезаписать более новые значения.
3. PUT возвращает только success после записи; read-only passcode значения игнорируются.
4. Следующий GET подтверждает значения с нормализацией/aliases/defaults. Если между запросами прошла другая запись, GET может показать её более новое состояние; это не обещание snapshot isolation между HTTP-запросами.

## Владельцы реализации и приёмка

- [#1047](https://github.com/mikle89609199136-ui/CraneApp/issues/1047) (USER-B023): реализованы общий locked mutation path и PostgreSQL regression tests для bulk/section writers.
- #495 — typed validation всех сохраняемых sections, root unknown keys и null/shape policy; #453 — точные leaf schemas, errors и DTO; #451 — единые defaults/normalization чтения.
- #1042 — notification/sound resolver и миграция; #1040 — [реализованная Appearance compatibility](appearance-settings.md); #1041 — доставка изменений. Эти задачи используют решение #454, не заменяют его конкурентные regression cases.

Приёмка backend-реализации: barriers/две DB connections для воспроизводимой гонки bulk против canonical settings/privacy/preference; сохранение disjoint keys; два folders replacement в определённом порядке; rollback на invalid mixed patch/ошибке БД; no-op/omitted/null/empty semantics; неизменность passcode; alias priority/error cases из #496 и совместимые responses. Проверять на настоящем PostgreSQL, а не только SQL mock. Production data в #454 не изменяются.
