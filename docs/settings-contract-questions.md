# Настройки пользователя: что выяснилось и что спрошено у бэкенда

Собрано 31 августа 2026 при переписывании страницы настроек (эпик #239).
Здесь только проверенные факты: каждый подтверждён либо чтением кода с
указанием места, либо запросом к базе локального стенда.

Документ нужен, чтобы не выяснять это заново: половина находок не видна
из клиентского кода вообще, а вторая половина видна только если знать,
куда смотреть.

## Как хранятся настройки

Одна таблица `users.settings`, семь колонок `jsonb` без схемы плюс
служебные поля:

| Колонка | Что внутри |
|---|---|
| `settings` | `theme`, `notifications`, `sounds`, `language` (+ наш `avatarShape`) |
| `privacy_settings` | `lastSeen`, `phoneVisibility`, `photoVisibility`, `messagesFromStrangers`, `groupsAdd`, `twoFactorAuth`, `autoDeleteAccount` |
| `notification_settings` | `privateChats`, `groups`, `channels`, `calls`, `videoCalls`, `inAppNotifications`, `messagePreview`, `readReceipts`, `reactions`, `newContacts` |
| `sound_settings` | `notificationsVolume`, `mediaVolume`, `notificationsSound`, `messagesSound`, `sendSound`, `callsSound`, `vibrateOnCall`, `notificationSound`, `messageSound`, `ringtone` |
| `storage_settings` | `autoDownloadMobile`, `autoDownloadWifi`, `autoDownloadRoaming`, `deleteMediaAfter` |
| `advanced_settings` | `autoReconnect`, `fastConnection`, `connectionType`, `dataCompression`, `saveDrafts`, `analytics`, `developerMode`, `debugLog`, `hardwareAcceleration`, `autoplayGifs` |
| `folders` | пустой список |

Состав проверен запросом к базе стенда, а не по умолчанию в миграции —
это разные вещи, см. ниже.

Сохранение — слияние по верхнему уровню: `settings = settings || $2::jsonb`
(`internal/user/service.go:313`). Поэтому патч из одного поля работает и
остальные поля не затирает. **Оговорка:** слияние поверхностное. Если
настройка станет вложенной, патч `{"notifications": {"calls": false}}`
заменит весь объект `notifications` целиком.

## Что спрошено у бэкенда

### 1. Состав настроек описан трижды и разошёлся

- `migrations/0003_users.sql:15-16` — умолчания колонок;
- `internal/auth/service.go:105-115` — регистрация вставляет свои наборы;
- `internal/user/handler.go:602-631` — третий набор как запасной при чтении.

Расхождение уже есть: в миграции у `privacy_settings` пять полей, в
регистрации семь — добавлены `twoFactorAuth` и `autoDeleteAccount`. Кому
запись создаст `ensureSettings`, а не регистрация, получит усечённый набор.

Просьба: оставить одно описание, остальные выводить из него.

### 2. Значения не проверяются

`Settings` принимает `map[string]any` и льёт в jsonb как есть.
`{"lastSeen": 123}` сохраняется и отвечает 200 — заведено как #439.

Практическое следствие: клиент записал поле `avatarShape`, которого нет ни
в одном описании на сервере, и оно легло в базу.

### 3. Уведомления и звуки задвоены

В `settings` лежат булевы `notifications` и `sounds` — их переключает
нынешний экран. Одновременно есть `notification_settings` и
`sound_settings` с подробными наборами по десять полей, заполняемыми при
регистрации.

Вопрос: что источник правды. Предложение клиента — опираться на подробные
колонки, а булевы из общего мешка убрать.

### 4. Добавить `avatarShape` в умолчание

Клиент даёт выбрать, чем заменять фотографию: буквой или сеткой (#375).
Значение кладётся в `settings` рядом с темой. Сейчас держится только на
том, что проверки нет.

### 5. Нужны ли отдельные адреса

`/users/all-settings`, `/users/notifications`, `/users/sounds`,
`/users/advanced-settings` вызывал только замороженный
`legacy/mobile-client`. Нынешний клиент не обращается ни к одному, хотя
методы в `UserService` заведены. Заведено как #454.

### 6. WebSocket отвечает 403 на локальном стенде

- в логах `chat`: `ws upgrade error err="websocket: request origin not allowed by Upgrader.CheckOrigin"`;
- у `edge` и `chat` заполнено `ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`;
- клиент подключается к `ws://localhost:3000/ws`, дев-сервер проксирует на
  `:8080` и Origin не подменяет — уходит браузерный `http://localhost:3000`;
- `edge` проксирует `/ws` через `httputil.NewSingleHostReverseProxy`, то
  есть заголовки не переписывает.

Причина не установлена: адрес в списке есть, а проверка его не принимает.
Прежнее объяснение — «стенд поднят без `localhost:3000` в списке» —
**неверно**, проверено.

## Что из этого следует для клиента

**Подробные настройки уведомлений и звуков на сервере уже есть.** Когда
дойдём до подробного экрана уведомлений, брать их из `notification_settings`
и `sound_settings`, а не из общего мешка. Сейчас экран показывает две
булевы величины, и разницы не видно — переделывать до появления экрана
незачем.

**Три поля приватности не показаны:** `phoneVisibility`, `photoVisibility`,
`groupsAdd` лежат на сервере и никем не управляются.

**Выбор языка ничего не переводит.** `public/locales/ru/translation.json`
пуст, файлов других языков нет вовсе. Клиент предлагает десять языков из
#162, меняет `lang` и экземпляр i18n, но все надписи берутся из запасных
значений `t('ключ', 'Русский текст')`.

**Разделять ли настройки по колонкам.** Разделение оправдано для
приватности: её читает сервер, отвечая другим людям. Остальные колонки
разделены по инерции старого клиента. Сливать их в одну не стоит:
слияние на сервере поверхностное, и разделы внутри одного объекта
сломают частичное обновление.
