# Appearance: настройки, применение и совместимость

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

## Проверка серверной части

`backend-v2/internal/user/appearance_integration_test.go` проверяет на настоящем PostgreSQL HTTP round-trip каждого Appearance enum/boolean через canonical и bulk API, сохранность соседних preferences/разделов, старые строки без backfill, alias priority и атомарный отказ. Defaults регистрации/восстановления проверяет settings_defaults_integration_test.go; конкурентный fontSize patch — settings_mutation_integration_test.go.

## Клиент #728 — 22 октября 2026

`ISettingsDto` использует enums из generated `MvpSettings`. `DEFAULT_PROFILE_SETTINGS` совпадает с JSON-источником серверных defaults; это проверяет тест. Отсутствующие поля дополняются при чтении, а на сервер отправляется только изменённый patch. Текущий источник — TanStack Query; отдельный Zustand appearance store удалён.

Во «Внешнем виде» доступны theme light/dark/system, три palette, шесть accentPreset, три textSize, три chatDensity, четыре переключателя ленты и avatarShape. Переключение оптимистичное; ошибка возвращает прежнее оформление. Пока PUT и его refetch не завершены, раздел блокирует повторный выбор: существующий rollback восстанавливает полный снимок, поэтому параллельные изменения из этого раздела не запускаются. Полноценное разрешение конкурирующих клиентских изменений остаётся #1041.

`data-theme-preference` хранит system/light/dark, `data-theme` — только вычисленную light/dark. Для system подписка `matchMedia('(prefers-color-scheme: dark)')` обновляет тему без PUT при смене ОС и удаляется при смене выбора/размонтировании. Карточки образцов тоже реагируют на ОС. Root attributes для palette/accentPreset/textSize/chatDensity меняют существующие токены; стандартные graphite/violet/medium/normal работают без дополнительных атрибутов.

### Размеры

`tokens/preferences.css` масштабирует все семантические размеры текста и их line-height. small = 0.9, medium = 1, large = 1.15. Например, текст сообщения 15px превращается в 13.5/15/17.25px. Rem, иконки и минимальные размеры кнопок не масштабируются вместе с текстом.

| Метрика                                | compact | normal | large |
| -------------------------------------- | ------- | ------ | ----- |
| Вертикальный padding строки чата       | 5px     | 9px    | 13px  |
| Аватар строки чата                     | 40px    | 46px   | 52px  |
| Вертикальный padding текстового пузыря | 5px     | 8px    | 12px  |
| Отступ между группами сообщений        | 4px     | 8px    | 12px  |
| Зазор виртуальных строк                | 2px     | 4px    | 6px   |
| Padding строки composer                | 3px     | 6px    | 10px  |

Размер текста и плотность независимы. При изменении размеров/видимости лента сбрасывает оценки виртуализатора и переизмеряет строки.

### Видимость и группировка

- `showMessageTime=false` скрывает timestamp в ленте, включая подпись для screen reader. Даты-разделители и исходные metadata сохраняются.
- `showMessageStatus=false` скрывает outgoing marks, включая часы отправки. Ошибка, retry/cancel, метки «изменено»/закрепления и отправка delivery/read receipts сохраняются.
- `showMessageAvatars=false` убирает аватары входящих сообщений группы и занятое ими место. Имена авторов и доступ к профилю остаются; аватары списка чатов, профилей и звонков не затрагиваются.
- `groupConsecutiveMessages=false` рисует каждый пузырь отдельным: имя/аватар автора на каждом входящем сообщении группы, собственные углы/отступы. Порядок, границы дат/непрочитанного и модель read receipts сохраняются. При включении используются прежние правила границ серий.

### Ранняя проекция и прежний браузерный выбор

`craneapp_settings` хранит ownerId и подтверждённые theme/palette/accentPreset/textSize/chatDensity/language. `index.html` применяет оформление до первого paint только при совпадении ownerId с сохранённым профилем, разрешая system по текущей ОС. Незнакомые значения и проекции без владельца игнорируются. Проекция не отправляется на сервер; во время оптимистичной записи она не обновляется. При выходе удаляется и оформление сбрасывается.

Прежний `craneapp_appearance` не переигрывается автоматически: серверные defaults невозможно отличить от намеренного выбора. При валидных старых значениях раздел предлагает кнопку применения прежней палитры/акцента. Она отправляет только palette/accentPreset; старый ключ удаляется лишь после успешного сохранения. Если человек не переносит его, действует серверный выбор. Невалидные старые значения пропускаются.

### Browser и visual regression

`frontend/playwright.appearance.config.ts` — отдельный прогон для локального backend на :8080 и Vite на :3000. Он создаёт новый тестовый аккаунт, проходит обязательную настройку облачного пароля и проверяет настоящий PUT → GET, reload, реакцию system на ОС и раннюю проекцию с заблокированным bundle React. Затем отправляет два сообщения в настоящий зашифрованный чат «Избранное» и проверяет применение настроек к composer/ленте. Изолированная browser fixture использует настоящие ChatListItem, MessagesList/MessageBubble и ComposerRow; сравниваются desktop/mobile screenshots, CSS-метрики и отсутствие горизонтального overflow. Базовые изображения зависят от платформы (первые эталоны — Chromium/macOS). Дата фиксирована; случайные рисунки аватаров нового аккаунта на settings screenshot маскируются, а аватары в fixture ленты имеют постоянные id.

```sh
cd frontend
npx playwright install chromium
npx playwright test --config playwright.appearance.config.ts
# Обновление эталонов после осознанного изменения дизайна:
npx playwright test --config playwright.appearance.config.ts --update-snapshots
```

Unit/integration tests проверяют каждый новый patch, rollback документа и проекции, явный перенос, keyboard navigation, подписку ОС/cleanup, общие defaults, ранний startup script, группировку/аватары и сохранение read receipts/retry при скрытых отметках.

### Оставшаяся связанная работа

#1041 остаётся отдельной задачей: транспорт инвалидации между вкладками/устройствами, срок сходимости, focus/reconnect и защита от запоздавших ответов при конкурентных изменениях. Сохранение и применение в текущей вкладке не означают готовность этой синхронизации. Полностью закрывать родительскую #728 следует после приёмки #1041. Уведомления в открытом приложении — #725; серверная миграция #1042 уже реализована. Анимации, animated emoji/stickers и autoplay GIF в MVP-настройки не добавлены.

Проверено локально 22 октября 2026: 267 файлов / 2350 unit/integration tests, 28 contract tests, production build, отсутствие циклов и lint изменённых файлов (без ошибок). Пять browser-сценариев проверяют шесть screenshot-эталонов; отдельный SQL read из PostgreSQL подтвердил system/midnight/teal/large/compact и showMessageTime=false после UI-записи. Общий `tsc -p tsconfig.app.json` по-прежнему содержит существующие ошибки проекта (в том числе старые поля DTO сообщений и Node typings в тестах); он не заменён формальным `npm run typecheck`, который не проверяет referenced app project.
