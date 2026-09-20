# MVP: состояние фронтенда

Дата статического аудита: 2026-09-18  
Проверенный commit: `d93a9ab`  
Источник требований: `MVP_scope_draft.md`

## Как читать статусы

- **Сделано** — пользовательский сценарий и его API-интеграция присутствуют в коде.
- **Начато** — есть существенная часть сценария, но один или несколько пунктов MVP отсутствуют либо не доведены до требуемого поведения.
- **Не сделано** — пользовательского сценария в текущем фронтенде нет.
- Это статическая оценка репозитория, а не результат полного ручного E2E на развёрнутом окружении.

## Основной MVP scope

| Раздел | Статус | Что уже есть | Что осталось |
|---|---|---|---|
| 1. Авторизация и доступ | **Начато** | Регистрация, вход, выход, сохранение bearer-сессии, выход со всех устройств, экран активных сеансов. Используются `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/sessions`. | Нет восстановления доступа. Access token хранится в `localStorage`; это прямо противоречит п. 17.1. Нет UI завершения одной конкретной сессии. |
| 2. E2E-шифрование | **Начато** | Есть клиентские ключи, envelope/signing, шифрование текста и медиа, обработка нечитаемых сообщений, ротация/получение chat keys и reconnect-resync. | Нельзя считать подтверждёнными multi-device и доступ к старой истории на новом устройстве. После удаления локальных ключей UI прямо предупреждает, что история не восстановится. Требуется отдельное сквозное тестирование ответов, edit/delete/forward и смены устройства. |
| 3. Личные чаты | **Сделано с оговорками** | Создание private chat, список/открытие, last message, unread counter, поиск пользователя, профиль собеседника, online/last seen, обновление после reconnect. | Нужен полноценный E2E reconnect-тест на реальном WebSocket и проверка всех privacy-ограничений. |
| 4.1. Базовые сообщения | **Начато** | Отправка/получение текста, optimistic outbox, retry/cancel ошибки, порядок и дедупликация входящих, mark-as-read. `GET/POST /messages/{chatId}`, `POST /messages/read`. | В пузыре нет законченной индикации `sent/delivered/read` и точного времени прочтения. Клиент отправляет `messageIds`, но сервер сейчас их игнорирует. |
| 4.2. Ответы | **Сделано** | Reply composer, превью исходного сообщения и переход к нему; `replyTo` уходит через `POST /messages/{chatId}`. | Проверить E2E для зашифрованных ответов после reconnect. |
| 4.3. Редактирование | **Начато** | Редактирование своего сообщения, признак «изменено», `PUT /messages/{messageId}`. | Время изменения не показывается. |
| 4.4. Удаление | **Начато** | Удаление своих сообщений и групповое удаление своих; `DELETE /messages/{messageId}`. | Нет выбора «у себя / у всех» и нет подтверждения удаления. Текущий API выполняет общее удаление. |
| 4.5. Реакции | **Сделано** | Добавление, снятие и замена реакции, optimistic update, отображение агрегатов и своей реакции; `POST/GET /messages/{messageId}/reactions`. | UI показывает счётчик и `myReaction`, но не список авторов реакции — этот пункт требует расширения ответа/UI. |
| 4.6. Закрепление | **Начато** | Закрепить/открепить, список и навигация к закреплённому; `GET /chats/{chatId}/pins`, `POST/DELETE /chats/{chatId}/pins/{messageId}`. | Нет режима «у себя / у всех»: реализовано одно общее закрепление чата. |
| 4.7. Копирование | **Начато** | Копирование текста одного или нескольких сообщений. | Нет отдельного копирования бинарного медиа в clipboard. |
| 4.8. Сохранение | **Начато** | Файлы скачиваются через `<a download>`, изображения открываются в viewer. | Для изображений/видео нет явного, единообразного действия «Сохранить». |
| 4.9. Пересылка | **Сделано с оговорками** | Пересылка одного/нескольких сообщений по очереди, текста и медиа, исходный автор; `POST /messages/{messageId}/forward`. | Нужен интеграционный E2E для E2E-медиа и частичного сбоя внутри пачки. |
| 4.10. Выбор нескольких | **Сделано с оговорками** | Режим выбора, toggle/cancel, copy/forward/delete своих, pin/unpin. | Удаление не предлагает «у себя / у всех»; пачка отправляется последовательными одиночными запросами. |
| 5. Форматирование текста | **Не сделано** | Есть только распознавание хэштегов и отдельная функция перевода. | Нужны модель форматированного текста, composer toolbar и renderer для bold/italic/underline/strike/mono/link/quote/spoiler/register transforms. Следует определить контракт формата до UI. |
| 6. Медиа и файлы | **Начато** | Выбор и отправка изображения/видео/аудио/файла, preview, image viewer, audio/video players, download файла, client limit 100 МБ, E2E-медиа, состояния uploading/failed. `POST /media`, `GET /media/{id}`. | Нет upload progress по байтам, явного allowlist типов на клиенте, копирования медиа, единообразного download всех типов. Лимит клиента должен совпадать с серверной конфигурацией. |
| 7. Избранное | **Не сделано на фронте** | Бэкенд-API и таблица существуют. | Добавить действия favorite/unfavorite, экран списка, открытие исходного сообщения, отображение файлов/медиа. Подключить `GET /messages/favorites`, `POST/DELETE /messages/{messageId}/favorite`. |
| 8. Звонки 1:1 | **Начато** | Аудио/видео вызов из чата, incoming/outgoing UI, accept/reject/end, mute/camera controls внутри call frame; REST room + WebSocket signaling + WebRTC/STUN/TURN. | Переключение камеры и reconnect нужно подтвердить/доделать E2E. Логика рассчитана также на группы, хотя групповые звонки исключены из MVP. Нет устойчивого восстановления звонка после reload/reconnect. |
| 9. Недавние звонки | **Не сделано** | В чате отображаются итоговые call-сообщения со статусом и длительностью. Страница Meetings — заглушка. | Нужен отдельный список входящих/исходящих/пропущенных, repeat call, переходы в чат/профиль и API истории. |
| 10. Мой профиль | **Начато** | Просмотр своего/чужого профиля, изменение имени/фамилии/bio; `GET/PUT /users/me`, `GET /users/{id}/profile`. | Кнопка смены фото disabled, username не редактируется. Хотя endpoints аватара/check-username есть, UI их не использует. |
| 11. Устройства | **Начато** | Экран списка и logout-all; `GET /auth/sessions`, `POST /auth/logout-all`. | Нет действия завершить одну сессию. В UI «текущим» считается просто первый элемент. Есть параллельное `/users/devices` API, но экран работает не с ним — контракт нужно унифицировать. |
| 12. Уведомления и звуки | **Начато** | Browser Notification на realtime `new_message`, безопасный preview, unread badge/count, mark-read; настройки notifications/sounds сохраняются через `PUT /users/settings`. | Флаги настроек не применяются в `NotificationManager`; звука нового сообщения нет; call ringtone не связан с настройкой; mute отдельного чата и настройка preview отсутствуют; Web Push/service worker нет. |
| 13. Конфиденциальность | **Начато** | UI last-seen visibility и messages-from-strangers; API privacy; на клиенте есть экран blocked API methods. | Нет UI чёрного списка; нет настройки звонков; серверные privacy-значения не валидируются и ограничения не подтверждены во всех chat/call/profile сценариях. |
| 14. Оформление | **Сделано частично** | Светлая/тёмная тема, применение ко всему UI, серверное сохранение и local projection до первого render. | Нет системной темы. Расширенный блок после разделителя разобран отдельно ниже. |
| 15. Язык | **Сделано** | Выбор RU/EN, полные словари этих языков, сохранение, применение ко всему приложению, browser language detection для первого запуска. | Новые языки добавлять только вместе со словарями. Проверить первый вход и серверное значение в E2E. |
| 16. Realtime | **Начато, основа готова** | Один WebSocket client, новые сообщения/read/reactions/chat updates, heartbeat, exponential reconnect, wake-up on online/visibility, resync, disconnect при logout. | Bearer передаётся в query string; нужен cookie handshake. Нужны нагрузочные/E2E проверки нескольких вкладок, logout-all и восстановления без дубликатов. |
| 17. Технические требования | **Не выполнено полностью** | Есть обработка API errors, outbox/dedupe, reconnect/backoff, heartbeat, Origin check на сервере. | Главные blockers: token в `localStorage` и URL WebSocket; read hook повторно шлёт все видимые IDs, backend игнорирует IDs; нет cookie auth. |
| 18. UI / UX | **Начато** | Общие loading/empty/error компоненты, responsive layouts, context menus, modals, disabled/hover/selected states и UI kit. | Нужен системный проход по всем сценариям на narrow/mobile и визуальный regression-аудит; ряд экранов остаётся заглушками. |
| 19. Не входит | **Скоуп расходится с кодом** | Код звонков содержит group room/invites и лимит до 5 участников. | Для MVP либо скрыть/запретить group calls, либо явно изменить scope. |
| 20. Известные GAP | **Подтверждены в основном** | В коде действительно нет общей call history/username edit/Web Push; bearer лежит в `localStorage` и попадает в WS URL; read receipts не соответствуют требованию. | После исправлений обновлять этот раздел и добавить автоматические проверки на security/read regressions. |

## Эндпоинты, уже используемые фронтендом для MVP

Префикс API-клиента: `/api/v2`.

| Область | Эндпоинты |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/sessions`, `POST /auth/change-password` |
| Пользователь | `GET/PUT /users/me`, `GET /users/search`, `GET /users/{userId}/profile`, `GET/PUT /users/settings`, `PUT /users/privacy`, blocked/devices methods в сервисе |
| Чаты | `GET /chats`, `POST /chats/private`, `GET /chats/{chatId}`, members/pin/archive/mute endpoints |
| Сообщения | `GET/POST /messages/{chatId}`, `PUT/DELETE /messages/{messageId}`, `POST /messages/read`, reaction/pin/forward endpoints |
| Медиа/crypto | `POST /media`, `GET /media/{id}`, `/encryption/keys*`, `/encryption/chat-keys/{chatId}`, `/encryption/rotate-key/{chatId}`, `/encryption/my-key/{chatId}` |
| Звонки | `POST /calls/rooms`; signaling идёт через `/ws` |

## Отдельно: блок после `+**********************`

### 7. Оформление — как у Telegram Web

| Требование | Статус | Что сделано | Что сделать на фронте | Endpoint |
|---|---|---|---|---|
| Светлая / тёмная тема | **Сделано** | Выбор в `AppearanceSection`, CSS tokens, мгновенное применение и сохранение. | Только E2E/visual regression. | `GET/PUT /users/settings`, поля `theme: light\|dark` |
| Тема «как в системе» | **Не сделано** | В коде явно оставлены только две темы. | Добавить `system`, слушать `matchMedia('(prefers-color-scheme: dark)')`, хранить выбор отдельно от вычисленной темы. | Тот же endpoint, `theme: system` |
| Цвет акцента | **Не сделано** | Акцент задан статическими design tokens. | Добавить picker/presets и применять CSS variables к кнопкам, selected messages и ссылкам. | Тот же endpoint, предлагается `accentColor` или `accentPreset` |
| Размер текста | **Не сделано** | Общие typographic tokens есть, пользовательского выбора нет. | Добавить 3 режима и root attribute/CSS scale. | Тот же endpoint, предлагается `textSize: small\|medium\|large` |
| Размер элементов чата | **Не сделано** | Есть responsive layout, но нет density setting. | Добавить compact/normal/large и адаптировать bubble/list/composer spacing. | Тот же endpoint, предлагается `chatDensity` |
| Показывать время | **Частично** | Время всегда показывается. | Добавить switch и условный render. | Тот же endpoint, `showMessageTime` |
| Показывать статус | **Частично** | Есть pending/uploading/failed; read хранится в модели, но полноценные sent/delivered/read markers не нарисованы. | Сначала закончить receipt contract, затем switch и UI markers. | Тот же endpoint + исправленный `POST /messages/read`/realtime receipts |
| Показывать аватары | **Не сделано как настройка** | В bubble нет управляемого отображения avatar каждого сообщения. | Добавить avatars в ленту и switch. | Тот же endpoint, `showMessageAvatars` |
| Группировать сообщения автора | **Не сделано** | Каждое сообщение рисуется самостоятельным bubble. | Рассчитывать группы соседних сообщений и менять отступы/avatar/tail. | Тот же endpoint, `groupConsecutiveMessages` |
| Анимации интерфейса | **Не сделано как настройка** | CSS transitions есть всегда. | Добавить флаг и учитывать `prefers-reduced-motion`. | Тот же endpoint, `interfaceAnimations` |
| Анимация эмодзи | **Не сделано** | Специального renderer/setting нет. | Определить animated emoji asset/renderer и toggle. | Тот же endpoint, `animatedEmoji` |
| Анимация стикеров | **Не сделано** | Sticker image поддержан, управление анимацией отсутствует. | Добавить pause/play policy и toggle. | Тот же endpoint, `animatedStickers` |
| Автовоспроизведение GIF | **Не сделано как настройка** | GIF отображается обычным `<img>`, поэтому фактически проигрывается всегда. | Ввести preview/static frame и управляемое autoplay. | Тот же endpoint, `autoplayGifs` |

Все настройки оформления можно сохранить через уже существующий универсальный `PUT /api/v2/users/settings`. Но перед подключением UI желательно зафиксировать типизированный schema/enum-контракт: сейчас сервер принимает произвольный JSON, а `ISettingsDto` содержит только `language`, `theme`, `notifications`, `sounds`, `avatarShape`.

### 10. Язык

Статус: **сделано для RU/EN**. Используется `GET/PUT /api/v2/users/settings`, поле `language`. Есть автоопределение языка браузера и применение через i18next. Для каждого следующего языка нужен полный `frontend/public/locales/<lang>/translation.json`, пункт в `LANGUAGES` и E2E smoke test.

### 11. Звонки — записывать последние звонки

Статус: **начато только на уровне сообщений чата**. Завершённый звонок появляется как `type: call` в истории конкретного чата; отдельная страница `MeetingsPage` является заглушкой.

Нужно:

1. Добавить frontend endpoint, например `GET /calls/history?cursor=&limit=&type=`.
2. Создать query/model списка последних звонков.
3. Реализовать incoming/outgoing/missed, audio/video, дату, duration, repeat call, переход в chat/profile.
4. Обработать pagination, loading/empty/error и realtime invalidation.

Текущие endpoints `GET/POST /calls/rooms`, `GET /calls/rooms/{id}` описывают активные комнаты и не заменяют историю.

### 21. Информация от разработчика

Статус: **версия сделана**. Экран «О приложении» показывает `APP_VERSION`, которую Vite берёт из `frontend/package.json`; API для версии не нужен. Также экран уже содержит экспорт данных (`GET /users/export`) и локальное удаление ключей.

Если нужны дополнительные сведения, добавить build commit/date/environment через build-time constants; endpoint вроде `GET /meta` нужен только для отображения версии backend/API, migration revision или server build.

## Приоритетные frontend blockers для MVP

1. Перевести auth с `localStorage`/bearer-in-WS-URL на согласованную cookie-схему.
2. Исправить read receipts end-to-end и дорисовать sent/delivered/read + timestamp.
3. Реализовать password recovery и корректное управление отдельной сессией.
4. Подключить уже готовый backend favorites API.
5. Сделать отдельную историю звонков после появления backend endpoint.
6. Довести privacy/notifications settings до реального применения, а не только сохранения.
7. После фиксации settings schema реализовать обязательный расширенный appearance block.
