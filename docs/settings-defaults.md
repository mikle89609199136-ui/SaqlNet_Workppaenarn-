# Единые defaults настроек

Реализация #451, 17 октября 2026. Значения определены в `backend-v2/internal/platform/settingsdefaults/defaults.json`. Это источник для Go read projection/privacy, регистрации и генерации SQL defaults. Набор MVP и семантика полей — в [User API contract](user-api-contract.md).

Регистрация задаёт общий settings из этого источника, сохраняя переданный язык. Остальные columns, как и восстановление через `ensureSettings`, используют SQL defaults из новой миграции `0040_settings_defaults.sql`. Она содержит только `ALTER COLUMN SET DEFAULT`: существующие строки и их `updated_at` не меняются. Старые миграции не правятся.

Defaults включают полный Appearance contract (#453), `avatarShape=letter`, `callSounds=true`, каноническую privacy (phoneVisibility=nobody, autoDeleteAccount=true), все detailed legacy objects, folders=[], passcodeEnabled=false и passcodeTimeout=60. Это не включает применение Appearance в UI, sound alias resolver или исправление passcode timeout handler (#442).

Все способы чтения дополняют недостающие keys одним набором. Пустой объект становится полным default object в ответе. Сохранённые допустимые значения, включая false/0, остаются приоритетными; GET не переписывает существующие строки. Неверные booleans/volumes по #495 закрываются в false/0, остальные неверные значения используют default, если он определён. При повреждении целого object alerts/legacy boolean preferences остаются закрытыми. Отсутствующий autoDeleteAccount получает true, явно сохранённый false или повреждённый флаг остаётся false. Folders JSON null читается как [].

## Defaults не являются patch

Partial PUT не получает default keys. Для bulk и legacy section read-modify-write используется отдельное sparse состояние; default projection добавляется только к ответу. Иначе unrelated изменение темы могло бы записать отсутствующие sounds/callSounds=true и поменять приоритет будущей миграции #1042. Регрессия проверяет физическое отсутствие этих keys в БД после bulk patch, а также отсутствие отсутствовавшего notificationsSound после изменения ringtone.

Canonical SQL merge сохраняет omitted keys, bulk сохраняет omitted/null/empty sections. Глобального backfill нет; alias/Appearance migration остаются #1042/#1040, same-section concurrency — #1047.

## Как менять defaults

1. Изменить `defaults.json` и описания defaults в OpenAPI/docs. Не добавлять JSON Schema default в partial request: он меняет optional-семантику generated types.
2. Создать **новую**, ещё не применявшуюся миграцию:

   ```bash
   cd backend-v2
   go run ./cmd/settings-defaults-migration --output migrations/NNNN_settings_defaults.sql
   ```

   Генератор не перезаписывает существующие файлы. При обновлении defaults нельзя регенерировать `0040`; используется следующий номер.

3. Проверить shared source, сгенерированную последнюю миграцию, физические SQL defaults и register/recovery/legacy HTTP round-trip. Тесты требуют совпадения последней migration с источником, проверяют повторяемость и отсутствие backfill.

```bash
cd backend-v2
go test -tags=integration ./internal/user ./internal/auth ./internal/platform/privacy ./internal/platform/settingsdefaults
go test -tags=integration ./cmd/migrate
```

SQL migration — версионированный артефакт источника, а не второй вручную поддерживаемый набор значений. Изменение defaults выпускается вместе с новой миграцией и Go-кодом; штатный deploy применяет миграции перед сервисами.
