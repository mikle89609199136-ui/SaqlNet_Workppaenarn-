# Настройки: аудит реализации и бэклога MVP-GO

Дата: 16 октября 2026. Проверена локальная ветка `dev`, commit `d658b383`.

> **Продолжение в #498:** выбор маршрутов и совместимости зафиксирован в
> [каноническом Settings API](../settings-api.md): `GET/PUT /users/settings`,
> `PUT /users/privacy`, отдельные ресурсы исключений и чёрного списка.
> Bulk и неиспользуемые section routes помечаются deprecated без удаления на сервере;
> runtime defaults/validation и миграция уведомлений остаются следующими задачами.

## Основание и границы проверки

Требования: [#728](https://github.com/mikle89609199136-ui/CraneApp/issues/728), #725, #720, #726, #727, #855 и `docs/redesign.md` (#828). Проверены все 131 issue с `mvp-go` (включая закрытые); ниже отобраны относящиеся к настройкам. Для открытых задач проверено также поле Status проекта Developer board: OPEN не равнозначен Backlog. Дополнительно прочитаны #453, #717, #828, #882; при подготовке задач проверена также существующая #497: они связаны с настройками, но отсутствуют в полученной выборке `mvp-go`.

Это чтение исходников и контрактов с запуском существующих unit/component-тестов. Проверка реальной БД, браузера, production, доставки push и нескольких устройств не проводилась. «Есть в коде» не означает принятую задачу или подтверждённый production-сценарий. Исторические аудиты от 18 сентября и наблюдения от 31 августа не являются текущей спецификацией настроек.

## Какие настройки нужны

Обязательный набор оформления по #728:

| Настройка                     | Сейчас                                                           | Что осталось                                                                                      |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Светлая / тёмная тема         | UI, серверное сохранение, применение, проекция до первого render | Включить в строгую схему и regression-проверки                                                    |
| Системная тема                | Нет: DTO и picker допускают только `light/dark`                  | `system`, подписка на смену ОС, отдельно выбранная и вычисленная тема, раннее применение          |
| Акцент                        | Есть picker и применение шести presets                           | Серверное поле `accentPreset`, миграция локального `accent`, синхронизация                        |
| Размер текста                 | Нет пользовательской настройки                                   | Контракт, control, применение typographic tokens                                                  |
| Размер элементов чата         | Нет пользовательской настройки                                   | `chatDensity`, control, размеры списка/пузырей/composer                                           |
| Показывать время              | Время уже отображается                                           | `showMessageTime`, переключатель, условный render                                                 |
| Показывать статус             | Статусы/receipts уже реализованы (#657/#721/#919)                | `showMessageStatus`, переключатель; скрытие оформления не должно отключать доставку/read receipts |
| Показывать аватары            | Аватары входящих групповых сообщений уже есть                    | `showMessageAvatars`, переключатель и согласование области действия                               |
| Группировать сообщения автора | Уже вычисляются соседние группы, меняется вид пузырей            | `groupConsecutiveMessages`, переключатель; при выключении каждый пузырь самостоятельный           |

Дополнительно уже есть и должны сохраниться:

- Палитра фона `graphite/midnight/warm` из #828. Сейчас локальная; её серверное хранение прямо отложено в #728, хотя поле отсутствует в тексте #728.
- Вид аватара без фото: `avatarShape=letter|grid`. Сохраняется в generic settings, отсутствует в серверных defaults регистрации.
- Язык RU/EN: picker, словари, применение и серверное сохранение есть. Дополнительные языки в MVP не требуются.
- Уведомления, звуки сообщений, звуки звонков; push на конкретном устройстве и локальная громкость голосовых.
- Приватность последней активности, фото, пересылки и входящих звонков, исключения по людям, чёрный список.
- Профиль, пароль входа, сеансы; облачный пароль, passkey и QR в «Шифрование и устройства» — отдельные работающие сценарии, их не следует реализовывать заново в #728.

**Не входят в обязательный #728:** настройки анимаций интерфейса, animated emoji/stickers, autoplay GIF. Наличие анимаций в UI не делает их пользовательские переключатели обязательными. Не добавлять в MVP storage/advanced/folders/passcode, `phoneVisibility`, `groupsAdd`, 2FA или auto-delete только потому, что соответствующие поля/маршруты есть в legacy API. Облачный пароль резервной копии и 2FA — разные функции.

## Доказательства в коде

| Область             | Источники и вывод                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Оформление          | `frontend/src/pages/settings/ui/sections/AppearanceSection.tsx`, `entities/user/model/appearanceStore.ts`: две темы, три палитры, шесть акцентов, два fallback-аватара; палитра/акцент только localStorage                                                                                                   |
| DTO/defaults        | `frontend/src/entities/user/model/types.ts`, `defaultProfileSettings.ts`: `language/theme/notifications/sounds/callSounds/avatarShape`; полей #728 кроме theme нет                                                                                                                                           |
| Применение / старт  | `entities/user/model/useApplyPreferences.ts`, `frontend/index.html`: тема/язык и ранняя проекция; нет режима system и согласованной синхронизации настроек между устройствами                                                                                                                                |
| Лента               | `widgets/chat-messages/model/useVirtualMessagesFeed.ts`, `entities/message/ui/MessageBubble/MessageBubble.tsx`: группировка уже есть, время и статусы отображаются, групповые аватары есть; настроек управления ими нет                                                                                      |
| Сохранение FE       | `entities/user/api/settingsMutations.ts`, `model/settingsQuery.ts`: partial patch, optimistic cache, rollback, refetch; staleTime 5 минут. В `realtime/invalidationMap.ts` нет события обновления settings; мгновенную синхронизацию нельзя считать реализованной                                            |
| Сохранение BE       | `backend-v2/internal/user/handler.go` (`Settings`, `AllSettings`), `service.go` (`UpdateSettings`, `UpdateAllSettings`): generic map, SQL shallow merge для обычного PUT; bulk читает, сливает в памяти и записывает все разделы                                                                             |
| Defaults            | `backend-v2/internal/auth/service.go` (`defaultSettings`), `migrations/0003_users.sql`, `internal/user/service.go` (`ensureSettings`) и fallback handlers расходятся; registration не задаёт `avatarShape/callSounds`                                                                                        |
| Уведомления вкладки | `frontend/src/app/providers/NotificationManager.tsx`: учитывает hidden/permission, preview и отсутствие дубля при push; не читает `settings.notifications`, нет звука сообщения и подписки на входящий звонок                                                                                                |
| Push                | `features/push-notifications`, `backend-v2/internal/push/directory.go`: подписки и UI есть; серверный `Targets` фильтрует `settings.notifications=false`. Этот факт не исправляет обход в NotificationManager                                                                                                |
| Звонковый звук      | `frontend/src/features/call/model/callStore.ts`, `useCallSounds.ts`, `services/ringtone.ts`: запуск и остановка рингтона уже есть, читается отдельный `callSounds`; `sounds=false` не выключает звонок                                                                                                       |
| Privacy BE          | `backend-v2/internal/platform/privacy/{privacy,exceptions}.go`, `internal/chat/call_privacy.go`, `contracts/openapi/components/schemas.yaml`: канонический ключ `calls`, enum `all/nobody`, исключения и запрет звонков реализованы; `callsFrom` не принимается                                              |
| Privacy FE          | `frontend/src/pages/settings/ui/sections/PrivacySection.tsx`, `privacyRules.ts`, `entities/user/model/types.ts`: только lastSeen/photoVisibility/forwards; **calls отсутствует** и в DTO, и в маршрутах/редакторе                                                                                            |
| Сеансы              | `features/session-management/ui/SessionsManager.tsx`: использует настоящий `isCurrent`, показывает устройства, завершает все; кнопки одной сессии нет. BE `auth.Service.Sessions` вычисляет current по token hash; `user.Service.DeleteDevice` удаляет legacy device, не является готовым revoke auth-сессии |
| OpenAPI             | `backend-v2/contracts/openapi/paths/users.yaml`: общий settings всё ещё generic Object/response description; privacy уже имеет строгую переиспользуемую схему, включая calls                                                                                                                                 |

## Сверка существующих задач

Ссылки ниже — `https://github.com/mikle89609199136-ui/CraneApp/issues/<номер>`. Состояния сняты 16 октября; статус проекта приведён отдельно от состояния issue.

### Открытые задачи из mvp-go

| Issue | Status проекта | Реальный остаток / действие                                                                                                                                                                                 |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #728  | Backlog        | Общая fullstack-задача оформления: system/размеры/переключатели не сделаны; акцент, группировка, аватары и receipts уже имеют базу. Уточнить палитру и декомпозировать реализацию                           |
| #725  | Backlog        | Применить global enable в fallback NotificationManager, добавить звук сообщения, согласовать browser call notification, mute и единые правила. Не повторять готовые push/permission UI и callSounds control |
| #1001 | In review      | Рингтон и привязка к callSounds уже в коде; требуется review/приёмка жизненного цикла и браузерных ограничений, а не новая реализация с нуля                                                                |
| #559  | Backlog        | Персональный chat mute ещё отсутствует. Backend API/поле/доставка, затем frontend action/badge и подавление уведомлений; moderator member mute — другая функция                                             |
| #720  | Backlog        | Остался terminate одной чужой сессии и UX ошибок. Старое описание про «первый элемент — текущий» уже неверно                                                                                                |
| #706  | In progress    | Довести каноническую модель session/device и отзыв одного устройства; не создавать дубликат. Часть учёта уже сделана в #414/#423                                                                            |
| #443  | In review      | Проверить обновление metadata device при повторной регистрации; учитывать текущий review, не открывать второй дефект                                                                                        |
| #451  | Backlog        | Единые defaults регистрации, восстановления и всех способов чтения settings                                                                                                                                 |
| #495  | Backlog        | Строгая валидация всех оставленных разделов и обхода через bulk; privacy уже валидируется                                                                                                                   |
| #496  | Backlog        | Определить приоритет global/detail notification и sound settings, теперь включая callSounds и готовый push consumer                                                                                         |
| #498  | Backlog        | Выбрать поддерживаемые canonical routes, убрать/обозначить legacy; не превращать все старые маршруты в UI MVP                                                                                               |
| #454  | Backlog        | Bulk merge/replace и round-trip. Дополнительно учесть конкурентный read-modify-write: bulk может затереть параллельный section patch                                                                        |
| #855  | Backlog        | Отдельная fullstack-настройка прямых соединений/TURN. `contacts` конфликтует с текущим отсутствием модели контактов; требует решения до реализации                                                          |

### Уже закрытые задачи, результат виден в коде

| Issues                             | Что уже есть / оговорки                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #439, #783, #784                   | Privacy validation, единая policy, исключения по людям; не переносить старое «privacy не валидируется» в новый план                                           |
| #726, #786, #785, #789, #791, #792 | UI трёх privacy rules, исключения, безопасная пересылка, фото и приблизительный last seen. Несмотря на шире сформулированный #786, call rule в UI отсутствует |
| #714, #912                         | Сервер запрещает входящие звонки по calls/blocklist; UI управления calls ещё нужен                                                                            |
| #727, #760                         | Чёрный список и применение блокировок сообщений/звонков                                                                                                       |
| #560                               | Per-chat hide preview и безопасное применение в NotificationManager; не создавать эту функцию повторно                                                        |
| #1002                              | Отдельный переключатель callSounds, default true и selector; это не доказательство готовности всего #725                                                      |
| #414, #423, #406                   | Login-сессии, корректный logout одного токена, logout-all; завершение одной выбранной чужой сессии остаётся в #706/#720                                       |
| #598, #724, #716, #485             | Загрузка настроек/профиля, редактирование username и фото; не планировать повторно                                                                            |
| #657, #721, #919                   | Delivery/read model и отображение статусов; #728 добавляет управление видимостью                                                                              |

Связанные закрытые **вне исходной выборки mvp-go**: #828 — новый экран настроек, палитра и акцент; #717/#882 — backend/client Web Push. В исходной выборке не было #453 (контракт User API) и #497 (`avatarShape`); при актуализации GitHub обеим добавлена `mvp-go`, поскольку их settings-часть необходима #728/#495. #497 — существующий владелец серверного avatarShape, новый дубль не создавался.

## Что осталось на фронтенде

1. **#728: Appearance.** Добавить system, textSize, chatDensity и четыре boolean controls; перевести палитру/акцент на сервер с локальной проекцией. Использовать уже существующие renderer/grouping/receipts. Для аватаров определить: только лента или ещё список чатов; переключатель статуса не должен скрывать ошибку/повтор отправки.
2. **#728: применение и синхронизация.** Root attributes/tokens, ранняя тема без flash, смена ОС, разделение локального кэша пользователей, реакция на изменения с другого устройства/вкладки. Одного PUT + localStorage недостаточно. Определить SLA синхронизации (мгновенное событие или refetch), обработку offline и конфликтов.
3. **#725 + #559: уведомления.** Единая effective policy для fallback, push и звуков; сообщение со звуком, global/per-chat выключатели, активный чат, входящий звонок и исключение дублей. Push и browser permission уже имеют реализацию.
4. **#1043: frontend privacy calls.** В `IPrivacyDto/TPrivacyRule`, routes, search index и `PRIVACY_RULES` добавить `calls`; редактор `all/nobody` и allow/deny exceptions переиспользовать. Backend уже готов (#714). Приёмка: значение и исключения сохраняются; запрещённый caller не вызывает room/invite, разрешённое исключение работает, blocklist сильнее; RU/EN и component + integration/E2E.
5. **#720:** terminate одной сессии после готового #706. Сохранять текущее устройство и его E2E-ключи, обновлять список, показывать not-found/revoked/error.
6. **#855:** UI direct connection после согласования enum/TURN и effective policy пары. Не смешивать с «Кто может звонить».

Профиль/язык/чёрный список/облачный пароль не требуют новых задач для повторной реализации. Проверки E2E существующего поведения остаются частью приёмки.

## Созданные задачи и существующие зависимости

По поручению владельца созданы четыре GitHub issue с метками `mvp-go`, `module:*`, `type:feature`, `stack:*` и соответствующими `feature:*`:

| Issue                                                                            | Область                                    | Родитель / статус                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| [#1040 — USER-F002](https://github.com/mikle89609199136-ui/CraneApp/issues/1040) | Backend: полный Appearance и совместимость | Sub-issue #728, Backlog; `needs-info` до фиксации схемы   |
| [#1041 — USER-F003](https://github.com/mikle89609199136-ui/CraneApp/issues/1041) | Fullstack: синхронизация настроек          | Sub-issue #728, Backlog; `needs-info` до выбора стратегии |
| [#1042 — USER-F004](https://github.com/mikle89609199136-ui/CraneApp/issues/1042) | Backend: миграция notification/sound       | Sub-issue #725, Backlog; `needs-info` до решения #496     |
| [#1043 — USER-F005](https://github.com/mikle89609199136-ui/CraneApp/issues/1043) | Frontend: «Кто может звонить» и исключения | Backlog; связано с закрытыми #714/#786/#726               |

Синхронизация оформлена как fullstack-сценарий: выбор транспорта и обновление клиентов нужны при любом решении. Отдельная backend-задача только на ещё не выбранное WS-событие не создавалась. Существующие In progress/In review и закрытые задачи не переводились в другие статусы; новые задачи без Sprint и оценок остаются в Product Backlog.

### Существующие задачи — не дублировать

- #453 + #498: канонический API и исполнимая схема.
- #451: единые defaults; #495: validation (включая bulk); #497: серверный avatarShape.
- #496: решение notification/sound source of truth; #454: bulk semantics и безопасная конкурентная запись.
- #559: personal chat mute; #706: session revoke; #443 уже в review.
- #855: TURN/privacy пары уже fullstack; отдельный новый backend epic не нужен.

### #1040 (BE-1). Серверное хранение полного Appearance MVP и миграция старых настроек

**Контекст:** из общей #728 выделена backend implementation-подзадача #1040 с полным набором полей; существующая #497 сохраняет владение avatarShape. #453/#451/#495 покрывают контракт/defaults/validation, а не всю миграцию и совместимость.

**Требуется:** после согласования схемы реализовать чтение и partial PUT полного набора #728 плюс palette/avatarShape; нормализацию старых записей без этих полей; единые defaults для register/ensure/read; сохранить текущую тему/язык/notification flags. Согласовать unknown keys и null; синхронизировать OpenAPI/генерируемые типы. JSONB уже позволяет хранение: новая колонка на каждое поле не нужна; необходимость backfill определяется выбранным контрактом.

**Приёмка:** round-trip каждого поля; один patch не меняет соседние; новый и восстановленный пользователь получают один набор default keys; неверный patch возвращает `400 validation_failed` без частичной записи; legacy значения нормализуются предсказуемо; tests на Postgres. Зависимости #453/#498, совместная работа с #451/#495 без дублирования их scope.

### #1041 (fullstack, ранее BE-2). Синхронизация настроек устройств и вкладок

**Контекст:** #728 требует синхронизацию; отдельной настройки события/версии нет. Хранение в БД не обеспечивает обновление уже открытых клиентов.

**Требуется:** если выбран realtime, описать authenticated user-scoped `settings_updated` (предлагаемое имя) с версией/временем, публиковать после успешной записи, подписать все собственные подключения. В событии достаточно версии/инвалидации, не нужно раздавать полную приватность. Если выбран refetch вместо события, явно зафиксировать задержку и правила focus/reconnect; #1041 остаётся владельцем клиентской реализации и сквозной проверки, а ненужная backend-часть снимается из её scope. При необходимости conflict control определить revision/ETag до реализации.

**Приёмка:** два открытых клиента одного пользователя сходятся к серверному состоянию в согласованный срок; чужой пользователь событие не получает; failed PUT не порождает событие; reconnect перечитывает пропущенное состояние. Зависимости: решение синхронизации в #728, canonical API #498. Версии/ETag — предложение, не действующий API.

### #1042 (BE-3). Миграция notification/sound source of truth и применение во всех server consumers

**Контекст:** сама #496 требует после решения отдельную implementation/migration task. Сейчас push читает `settings.notifications`, а подробные legacy колонки существуют параллельно; клиент добавил `callSounds`.

**Требуется:** после #496 перенести/нормализовать данные и обновить consumers, чтение/запись и defaults. Зафиксировать независимость sounds/callSounds, поведение global notifications, возврат детальных значений при включении и приоритет chat mute из #559; проверить push сообщений/звонков и lifecycle подписок. Не реализовывать Web Push повторно.

**Приёмка:** одинаковое effective поведение при чтении любым поддерживаемым endpoint; global off блокирует серверную доставку; chat mute применяется до payload/delivery; обратное включение не теряет персональные значения; существующие подписки работают после миграции; интеграционные проверки. Зависимости #496/#498/#559, клиентская часть #725.

## Чего не хватает в docs для реализации

| Пробел                                            | Где зафиксировать / что решить                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Нет актуального единого settings-контракта        | #453/#498 и OpenAPI: точные GET/PUT responses, typed schemas, patch/omission/null/unknown keys, errors; privacy уже типизирована                                                                                                  |
| Нет согласованных enums/defaults Appearance       | #728: подтвердить proposal ниже, все размеры в design tokens, область действия visibility; добавить palette в контракт                                                                                                            |
| Старые рекомендации акцентов не совпадают с UI    | Брать существующие `violet/plum/orchid/indigo/amber/teal`, не старые blue/green/orange/pink                                                                                                                                       |
| Global/detail уведомления и callSounds не сведены | Решение #496 и таблица effective policy для global/per-chat, звуков, push, fallback, permission, active chat; глобальное отключение не равно удалению подписки                                                                    |
| Нет выбранной стратегии синхронизации             | #728: событие/refetch, срок, конкурирующие записи, ранняя проекция и смена пользователя; реализация и сквозная проверка в #1041                                                                                                   |
| Privacy docs/старые issues отстают                | Канонически `calls`, `all/nobody`; `callsFrom` отвергается. «Контактов» нет; messagesFromStrangers снят с UI в #465, не восстанавливать запрет автоматически                                                                      |
| Требования сеансов расходятся                     | Scope §11 требует «завершить все, кроме текущего», нынешний logout-all завершает включая текущее. В #706/#720 выбрать отдельное terminate-others либо обновить продуктовый scope; нельзя выдавать legacy delete devices за revoke |
| #855 требует contacts                             | Решить all/nobody или сначала модель контактов; описать policy пары и требования TURN совместно с #851                                                                                                                            |
| Email UI — заглушка                               | AccountSection сообщает, что привязка не работает. Не включать полноценную привязку email в настройки без отдельного scope/контракта; recovery #996/#997 — смежные задачи авторизации                                             |
| Нет единой матрицы приёмки settings               | Тема ОС, две вкладки/устройства, reload/offline/failed PUT, cache другого аккаунта, push/fallback, invalid input, новые/legacy пользователи и accessibility/visual checks                                                         |

### Предложение для согласования схемы (не действующий контракт)

| Поле                                                                                | Предлагаемый тип / default                                        | Основание                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| theme                                                                               | `light/dark/system`, default `dark`                               | Сохранить текущий default; system — явный выбор, если продукт не решит иначе |
| palette                                                                             | `graphite/midnight/warm`, `graphite`                              | Существующий #828; имя серверного поля ещё не утверждено                     |
| accentPreset                                                                        | `violet/plum/orchid/indigo/amber/teal`, `violet`                  | Маппинг нынешнего локального `accent`                                        |
| textSize                                                                            | `small/medium/large`, `medium`                                    | Предложение; определить реальные CSS sizes и доступность                     |
| chatDensity                                                                         | `compact/normal/large`, `normal`                                  | Предложение; определить размеры элементов                                    |
| showMessageTime / showMessageStatus / showMessageAvatars / groupConsecutiveMessages | boolean, `true`                                                   | Сохранить нынешнее отображение и группировку; уточнить область avatars       |
| avatarShape                                                                         | `letter/grid`, `letter`                                           | Текущий frontend default                                                     |
| language                                                                            | `ru/en`; первый выбор — согласованная locale регистрации/браузера | Не добавлять новые языки без словарей; сохранить существующий выбор          |
| notifications / sounds / callSounds                                                 | boolean, `true`                                                   | Сейчас общие flags; окончательная структура после #496                       |

Push permission/subscription — состояние устройства. Громкость голосовых — локальная настройка устройства с текущим default 1. Не переносить их автоматически в account-wide settings.

## Комментарии к существующим задачам

Опубликованы 18 комментариев с доказательствами, остатком работ и связями новых задач; исходные descriptions и состояния issues сохранены:

- [#728](https://github.com/mikle89609199136-ui/CraneApp/issues/728#issuecomment-6221064772)
- [#725](https://github.com/mikle89609199136-ui/CraneApp/issues/725#issuecomment-6221065334)
- [#720](https://github.com/mikle89609199136-ui/CraneApp/issues/720#issuecomment-6221065916)
- [#706](https://github.com/mikle89609199136-ui/CraneApp/issues/706#issuecomment-6221066406)
- [#443](https://github.com/mikle89609199136-ui/CraneApp/issues/443#issuecomment-6221066911)
- [#451](https://github.com/mikle89609199136-ui/CraneApp/issues/451#issuecomment-6221067418)
- [#495](https://github.com/mikle89609199136-ui/CraneApp/issues/495#issuecomment-6221067935)
- [#496](https://github.com/mikle89609199136-ui/CraneApp/issues/496#issuecomment-6221068636)
- [#498](https://github.com/mikle89609199136-ui/CraneApp/issues/498#issuecomment-6221069140)
- [#454](https://github.com/mikle89609199136-ui/CraneApp/issues/454#issuecomment-6221069547)
- [#855](https://github.com/mikle89609199136-ui/CraneApp/issues/855#issuecomment-6221069952)
- [#453](https://github.com/mikle89609199136-ui/CraneApp/issues/453#issuecomment-6221070346)
- [#497](https://github.com/mikle89609199136-ui/CraneApp/issues/497#issuecomment-6221070770)
- [#1001](https://github.com/mikle89609199136-ui/CraneApp/issues/1001#issuecomment-6221071215)
- [#559](https://github.com/mikle89609199136-ui/CraneApp/issues/559#issuecomment-6221071618)
- [#714](https://github.com/mikle89609199136-ui/CraneApp/issues/714#issuecomment-6221072116)
- [#786](https://github.com/mikle89609199136-ui/CraneApp/issues/786#issuecomment-6221072616)
- [#828](https://github.com/mikle89609199136-ui/CraneApp/issues/828#issuecomment-6221073030)

## Порядок реализации и проверки

1. Зафиксировать contract/source of truth/semantics: #453/#498/#496/#454; снять неизвестные по #728 и конфликту terminate-others.
2. Backend Appearance (#1040, #451/#495/#497) и notification migration (#1042); #559 и уже начатая #706 идут по своим зависимостям.
3. Frontend #728 и #725, privacy calls #1043 (не ждёт нового backend), затем #720; #1001 завершить review после проверки браузера.
4. Синхронизация #1041 по согласованной стратегии; end-to-end и visual приёмка. #855 — после решения contacts и TURN.

Запущены существующие тесты: `npm test -- src/pages/settings src/entities/user/model/useApplyPreferences.test.tsx src/app/providers/NotificationManager.test.tsx src/features/call/model/useCallSounds.test.tsx src/features/call/model/callStore.node.test.ts src/features/push-notifications` из `frontend/`: **16 файлов, 141 тест — passed**. Эти тесты не проверяют отсутствующие новые настройки, не доказывают доставку реального push и корректность production multi-device; E2E остаётся необходимой приёмкой реализации.
