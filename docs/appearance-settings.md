# Appearance: серверный контракт и совместимость

Реализация #1040, 17 октября 2026. Полный набор полей, enums и defaults определён в [User API contract](user-api-contract.md): theme, palette, accentPreset, textSize, chatDensity, showMessageTime, showMessageStatus, showMessageAvatars, groupConsecutiveMessages и avatarShape. Language/notifications/sounds/callSounds сохраняются независимо от оформления.

Canonical `GET/PUT /api/v2/users/settings` читает и частично обновляет все эти поля. Legacy bulk `/users/all-settings` использует ту же validation #495, defaults #451 и транзакционный mutation path #1047. `system` хранится как предпочтение; браузер разрешает его через prefers-color-scheme в #728.

## Старые размеры текста

`fontSize` и `textSize` имеют один enum: small/medium/large. Canonical API принимает только textSize; старый fontSize можно передать через deprecated bulk.

- При чтении валидный сохранённый textSize приоритетен. Если его нет или он повреждён, используется валидный fontSize; иначе medium из общего источника defaults.
- Bulk/export возвращают fontSize как проекцию разрешённого textSize. Это позволяет старому клиенту увидеть последующий canonical выбор. Canonical GET не выдаёт legacy aliases.
- При записи приоритет определяется **переданным patch**: textSize побеждает fontSize в одном запросе; если передан только fontSize, он записывает соответствующий textSize, даже если в БД уже есть canonical default/предыдущий выбор.
- Оба переданных поля проходят validation до любого SQL. Невалидный alias не скрывается корректным textSize; весь mixed patch получает 400 validation_failed без записи.
- Разрешение alias не меняет map вызывающего кода. Вычисленный patch записывается через общий locked mutation path; competing textSize/fontSize patches сериализуются как один preference.

## Старые цвета акцента

`accentColor` — произвольный legacy HEX #RRGGBB, а accentPreset — один из шести утверждённых presets. В контракте нет точного соответствия произвольного HEX пресету, поэтому сервер не выбирает ближайший цвет и не подменяет сохранённый HEX.

Валидный accentColor сохраняется в JSONB и возвращается через bulk/export, в том числе после изменения accentPreset. Canonical API использует только accentPreset; при его отсутствии применяется violet. Это сохраняет исходные legacy данные и не добавляет custom color в MVP. Невалидный сохранённый HEX скрывается по общим правилам #495.

## Строки без новых полей и миграция

Глобальный backfill не нужен: #451 уже задаёт полные SQL/registration/recovery defaults, а read projection дополняет старые строки и разрешает fontSize. GET не изменяет БД. Unrelated canonical/bulk patch не материализует textSize из старого fontSize и не записывает отсутствующие notifications/sounds/callSounds; это сохраняет происхождение данных для #1042. Явный fontSize patch мигрирует размер при записи.

Новые колонки, маркеры миграции и переписывание старых SQL migrations не требуются. Повреждённые значения нормализуются по #495 с указанным выше fallback для textSize; сохранённые false, theme, language, avatarShape и соседние разделы остаются приоритетны.

## Приёмка и оставшаяся клиентская работа

`backend-v2/internal/user/appearance_integration_test.go` проверяет на настоящем PostgreSQL HTTP round-trip каждого Appearance enum/boolean через canonical и bulk API, сохранность соседних preferences/разделов, старые строки без backfill, alias priority и атомарный отказ. Defaults регистрации/восстановления проверяет settings_defaults_integration_test.go; конкурентный fontSize patch — settings_mutation_integration_test.go.

Сервер не может прочитать browser localStorage. Перенос текущих локальных palette/accent, применение controls в интерфейсе, system theme и визуальная проверка остаются #728. Модель UI с light/dark пока сохраняется; полный wire type уже доступен как generated MvpSettings. Синхронизация открытых устройств/вкладок остаётся #1041, notification/sound migration — #1042. Серверная готовность не означает готовность этих клиентских сценариев.
