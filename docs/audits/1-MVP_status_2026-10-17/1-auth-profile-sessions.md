# Авторизация, профиль, устройства, auth-часть WebSocket

Срез: `origin/dev` @ `a465dbcd` (17.10.2026). Статический аудит кода, тесты и прод не запускались.
Пути указаны от корня репозитория.

Итог: **Готово — 27, Частично — 5, Нет — 1, Нужна ручная проверка — 1** (34 пункта).
Профиль закрыт полностью. Модель сессий на бэкенде готова (#706, #705, #409). Остатки — интерфейс управления сессиями, восстановление доступа и неполная очистка вкладки при выходе.

## 1. Авторизация и доступ

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Регистрация | Готово | Фронт: `frontend/src/features/auth/ui/RegisterWizard/RegisterWizard.tsx:164-186` → `frontend/src/services/AuthService.ts:34`. Бэк: `backend-v2/cmd/auth/main.go:60`, `backend-v2/internal/auth/handler.go:75-121` (cookie сессии ставится в `:119`), запись сессии `backend-v2/internal/auth/service.go:157` | — | — |
| Вход | Готово | Фронт: `frontend/src/features/auth/ui/LoginForm.tsx:73-103`, вход по QR `frontend/src/pages/login/ui/LoginPage.tsx:43-60`. Бэк: `backend-v2/internal/auth/handler.go:123-165`, `backend-v2/internal/auth/service.go:167-223` | Аккаунт с включённым 2FA войти паролем не может: форма показывает ошибку (`LoginForm.tsx:85-93`). 2FA не входит в MVP | — |
| Выход | Готово | Кнопка «Выйти из аккаунта»: `frontend/src/pages/settings/ui/sections/AccountSection.tsx:202-209`, обработчик `:45-61` → `frontend/src/services/AuthService.ts:61-72`. Бэк отзывает токен этой сессии, стирает cookie и шлёт событие закрытия сокетов: `backend-v2/internal/auth/handler.go:190-210`, `backend-v2/internal/auth/service.go:366-398` | Неполная очистка на клиенте — см. «Корректное завершение» | — |
| Восстановление доступа | Нет | Маршрутов сброса пароля нет ни на бэке (`backend-v2/cmd/auth/main.go:60-80`), ни на фронте (`frontend/src/app/router/router.tsx:109-141`). Ссылки «Забыли пароль?» в форме нет (`LoginForm.tsx:124-173`). Email сервер не хранит, в интерфейсе об этом прямо сказано: `AccountSection.tsx:240-245`. Колонок email/phone в схеме нет (`backend-v2/migrations/*.sql`). Обходной путь — вход по QR с другого устройства, где аккаунт уже открыт (`LoginPage.tsx:43-46`), но пароль так не восстановить | Бэк: запрос сброса, одноразовый код, установка нового пароля. Фронт: `/forgot-password` и `/reset-password`. Но сначала нужен канал доставки (email или другой), его сейчас нет | #704 (бэк, **без метки mvp-go**), #996, #997 (фронт, mvp-go). Канала (email) — нет задачи |
| Сохранение авторизации между сессиями | Готово | Cookie живёт 30 дней: `backend-v2/internal/platform/authctx/session.go:24,51-54`. Признак входа — сохранённый профиль: `frontend/src/entities/user/model/profileStore.ts:21-45`. На 401 профиль очищается и открывается вход: `frontend/src/app/router/router.tsx:14-50`, `frontend/src/app/router/AuthGuard.tsx:12-23` | Refresh нет: через 30 дней нужен повторный вход. Для MVP допустимо | — |
| Корректное завершение текущей сессии | Частично | Сервер всё делает правильно: отзыв токена, `revoked_at`, очистка cookie, `pg_notify` (`backend-v2/internal/auth/service.go:375-391`, `handler.go:208`). На клиенте `handleLogout` (`AccountSection.tsx:45-61`) **не вызывает** общий `clearAuthSession` (`frontend/src/features/auth/model/clearAuthSession.ts:10-40`): без перезагрузки вкладки в памяти остаются черновики (открытый текст), очередь исходящих, расшифрованные превью, blob-URL медиа, ключи чатов в памяти `CryptoService` (`forgetSession` не вызывается) и состояние `useChatUiStore`. Ошибка `POST /auth/logout` проглатывается (`AccountSection.tsx:48`): клиент считает, что вышел, а HttpOnly-cookie остаётся действующей ещё до 30 дней | Вызывать `clearAuthSession` из обоих выходов (обычного и «завершить все»). Если сервер не ответил на logout, сообщать об этом, а не делать вид, что выход прошёл | нет задачи |
| Завершение всех остальных сессий | Частично | Бэк: `POST /api/v2/users/devices/terminate-all` оставляет текущую сессию, отзывает токены остальных и закрывает их сокеты: `backend-v2/cmd/user/main.go:88`, `backend-v2/internal/user/service.go:1035-1038,1040-1128`. На фронте метод есть (`frontend/src/services/UserService.ts:141`), но его никто не вызывает. Единственная кнопка, «Завершить все сеансы», вызывает `/auth/logout-all`, а он завершает **и текущую** сессию (`frontend/src/features/session-management/ui/SessionsManager.tsx:30-57,149-160`, `backend-v2/internal/auth/service.go:401-440`). К тому же этот путь закрыт флагом `AUTH_LOGOUT_ALL_GENERATION_ENABLED` (по умолчанию `false`, ответ 503: `backend-v2/internal/auth/handler.go:217-220`, `backend-v2/cmd/auth/main.go:31-33`) | Кнопка «Завершить все, кроме этого» на `terminate-all` | нет задачи (расхождение отмечено только в комментарии p-force к #720 от 16.10) |

## 10. Мой профиль

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Аватар | Готово | `frontend/src/pages/settings/ui/sections/AccountSection.tsx:154-159`; поле `avatar_url` в `backend-v2/internal/user/service.go:136-156` | — | — |
| Имя | Готово | `AccountSection.tsx:138-141,161`; `GET /users/me`: `backend-v2/internal/user/handler.go:93-98` | — | — |
| Username | Готово | `AccountSection.tsx:162` | — | — |
| Информация «О себе» | Готово | Поле в форме `frontend/src/features/user-profile-edit/ui/ProfileEditForm.tsx:303-309`; показывается в своём профиле через `UserProfilePanel` (`AccountSection.tsx:218-230`) | — | — |
| Просмотр собственного профиля | Готово | Подраздел `me` (`frontend/src/shared/config/routes.ts:36-44`) открывает `UserProfilePanel` таким, каким профиль видят другие: `AccountSection.tsx:69-71,218-230` | — | — |
| Изменение аватара | Готово | `ProfileEditForm.tsx:192-244,257-272`: пересжатие, загрузка в медиа, затем `PUT /users/avatar` (`frontend/src/services/UserService.ts:26-30`; `backend-v2/internal/user/handler.go:147-165`). Сделано в #485 (`58ff5293`) | Сервер принимает в `avatarUrl` любую строку без проверки, что это своя загрузка (`user/service.go:136-147`) | #995 меняет доступ к медиа и кеширование аватаров (см. «Риски») |
| Изменение имени | Готово | `ProfileEditForm.tsx:163-183` → `PUT /users/me` (`UserService.ts:14-18`; `backend-v2/internal/user/handler.go:99-111`; `user/service.go:136-156`) | Длину имени сервер не проверяет: при >64 символах ответ 500 из БД. Фронт ограничивает 64 (`frontend/src/features/user-profile-edit/model/profileSchema.ts:7,18-26`) | #416 (не mvp-go) |
| Изменение username | Готово | `ProfileEditForm.tsx:87-133` (живая проверка занятости), `:150-161` → `PUT /users/me/username` (`UserService.ts:20-24`; `backend-v2/cmd/user/main.go:133`; `backend-v2/internal/user/handler.go:117-145`). Сервис: реестр имён, раз в 24 часа, журнал смен, событие для других клиентов (`backend-v2/internal/user/service.go:29,158-264`). Сделано в #716 и #724 (`82289d0f`) | — | — |
| Изменение «О себе» | Готово | `ProfileEditForm.tsx:163-183,303-309`; `user/service.go:144` | Лимит 160 символов только на фронте (`profileSchema.ts:8,50-56`). На сервере колонка `TEXT` без проверки (`backend-v2/migrations/0003_users.sql:5`) | нет задачи (мелочь) |

## 11. Устройства

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Список активных сессий | Готово | `SessionsManager.tsx:24,128-147` → `GET /auth/sessions` (`frontend/src/services/AuthService.ts:255-259`, `frontend/src/entities/user/model/securityQueries.ts:15-21`, перезапрашивается при каждом открытии). Бэк: `backend-v2/internal/auth/service.go:526-563`, единая модель `auth.sessions` (`backend-v2/migrations/0039_canonical_device_sessions.sql`) | — | — |
| Отображение текущего устройства | Готово | Сервер вычисляет `isCurrent` по хешу токена из cookie: `auth/service.go:533,546`. Клиент: `SessionsManager.tsx:61,135-139`; для старых сессий без учёта показывается предупреждение (`:119-126`) | — | — |
| Отображение других активных устройств | Готово | `SessionsManager.tsx:62,140-144`; имя и тип устройства берутся при входе (`frontend/src/shared/lib/utils/device.ts:9`, `AuthService.ts:34-58`) | — | — |
| Дата / время последней активности | Частично | В списке выводится `lastActive` (`SessionsManager.tsx:76-83`). Но `last_active` обновляется только при входе и регистрации (`auth/service.go:339-356`) и в `POST /users/devices/register` (`backend-v2/internal/user/service.go:994-1012`), а фронт этот адрес не вызывает (`UserService.ts:129-133`, вызовов нет). Запросы и heartbeat сокета `last_active` не трогают. По факту показывается время входа | Обновлять `last_active` при активности сессии с троттлингом (в middleware `authctx` или в heartbeat сокета) | нет задачи |
| Завершение отдельной сессии | Частично | Бэк готов (#706): `DELETE /users/devices/{id}` отзывает токен (`revoked_tokens`), закрывает сокеты (`NotifyRevocation`), на текущую сессию отвечает 409: `backend-v2/internal/user/handler.go:601-641`, `user/service.go:1031-1033,1072-1128`. На фронте метод есть (`UserService.ts:135-139`), но в `SessionsManager` нет ни кнопки, ни вызова (`SessionsManager.tsx:76-83`: элементы `ListStaticItem` без действий) | Действие на элементе чужой сессии: подтверждение, вызов, обновление списка, обработка 404/409/401 | #720 (mvp-go, назначена на aevuum, PR нет) |
| Завершение всех сессий, кроме текущей | Частично | См. раздел 1: бэк `terminate-all` готов (`user/service.go:1035-1038`), в интерфейсе только «Завершить все сеансы, включая это» через `/auth/logout-all` за флагом (`SessionsManager.tsx:149-160`) | Кнопка на `terminate-all`. Текущую кнопку оставить как «выйти везде» или убрать | нет задачи |

## 17.1. Авторизация (технические требования)

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Не хранить access token в `localStorage` | Готово | Токена нет ни в сторе, ни в запросах: `frontend/src/entities/user/model/profileStore.ts:6-9`, `frontend/src/shared/api/session.ts:3-30`. Оставшийся от старой версии ключ стирается при запуске и при выходе: `frontend/src/app/main.tsx:40-42`, `profileStore.ts:61-64`. `ApiClient` без `Authorization`, `credentials: 'same-origin'`: `frontend/src/shared/api/ApiClient.ts:105-113`. Сделано в #705 (`718fb6db`, PR #900) | — | — |
| Безопасная схема: HttpOnly / Secure / SameSite / cookie-auth | Готово | Cookie `__Host-craneapp_session` с `HttpOnly`, `Secure` в проде, `SameSite=Lax`, `Path=/`: `backend-v2/internal/platform/authctx/session.go:20-49`. Токен принимается только из cookie, Bearer удалён: `session.go:93-100`, `backend-v2/internal/platform/authctx/authctx.go:37-42`. Защита от подделки запросов: меняющий запрос с cookie и чужим `Origin` получает 403 (`session.go:132-145`, `backend-v2/cmd/edge/main.go:489-493`). Прод-образ ставит `CRANE_ENV=production`: `docker-entrypoint.sh:22-25`, `supervisord.conf:77` | Вживую проверить в DevTools на проде: имя `__Host-…`, `Secure`, `HttpOnly` | — |

## 17.2. WebSocket (авторизация сокета)

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Не передавать bearer token в URL WebSocket | Готово | Адрес без токена: `frontend/src/shared/config/app.ts:12-17`, `frontend/src/services/WebSocketClient.ts:76`. Сервер берёт токен только из cookie: `backend-v2/internal/chat/ws.go:187-193` | — | — |
| Cookie-auth для handshake | Готово | `ws.go:189-199`: только `TokenCookie`, затем проверка подписи и отзыва (`:201-223`) | — | — |
| Проверять `Origin` | Готово | `ws.go:28-32` (`CheckOrigin`) и `:196`: свой хост или точный адрес из `ALLOWED_ORIGINS`, `"*"` не даёт доступа: `backend-v2/internal/platform/authctx/session.go:105-130` | В проде `ALLOWED_ORIGINS` по умолчанию `"*"` (`docker-entrypoint.sh:31-36`), поэтому всё держится на сверке `Host`/`X-Forwarded-Proto` за прокси Amvera. Раз звонки и сокет в проде работают, сверка проходит | — |
| Logout закрывает активный WebSocket | Готово | `pg_notify` в транзакции отзыва (`backend-v2/internal/auth/service.go:390`; `backend-v2/internal/platform/authctx/revocation_event.go:19-28`). Его слушают все реплики chat (`backend-v2/cmd/chat/main.go:94`) и закрывают соединения с этим токеном (`backend-v2/internal/chat/ws_revocation.go:18-45`). Дополнительно отзыв перепроверяется на каждом входящем событии и heartbeat (`ws_revocation.go:47-71`; `ws.go:294,306,609`). Клиент тоже рвёт сокет сам: `AccountSection.tsx:49`. Сделано в #409 | — | — |
| Logout-all закрывает все WebSocket пользователя | Нужна ручная проверка | Код готов: событие с новым поколением токенов (`auth/service.go:410-427`) закрывает все соединения со старым поколением (`ws_revocation.go:29-31`). Но `/auth/logout-all` по умолчанию возвращает 503: флаг `AUTH_LOGOUT_ALL_GENERATION_ENABLED` выключен во всех конфигурациях репозитория (`.env.example:112`, `docker-compose.yml:84`, `docker-entrypoint.sh:13`, `infrastructure/kubernetes/v2/foundation.yaml:130`). Порядок включения в проде описан в `docs/prod-merge-runbook.md:70-81`. Включён ли флаг в Amvera, по коду не установить. Отдельно: `terminate-all` и `DELETE /users/devices/{id}` закрывают сокеты завершённых сессий без всякого флага (`user/service.go:1124`) | Проверить в Amvera значение `AUTH_LOGOUT_ALL_GENERATION_ENABLED`. Если `false` — «Завершить все сеансы» на проде показывает ошибку (`SessionsManager.tsx:49-53,101-108`) | #406 / #409 (закрыты) |

## 20. Известные GAP (часть области)

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Нет API изменения username | Готово (GAP закрыт) | `PUT /api/v2/users/me/username`: `backend-v2/cmd/user/main.go:133`, `backend-v2/internal/user/handler.go:117-145`, `backend-v2/internal/user/service.go:158-264`; интерфейс `ProfileEditForm.tsx:150-161` | — | #716, #724 (закрыты) |
| Device/session модель не связана с авторизацией | Готово (GAP закрыт) | Каноническая `auth.sessions` (`backend-v2/migrations/0039_canonical_device_sessions.sql:1-2`). `/users/devices` — лишь представление `auth.Service.Sessions` (`backend-v2/internal/user/service.go:1014-1029`). Токен принимается, только если у него есть живая сессия текущего поколения (`backend-v2/internal/platform/authctx/revocation.go:37-61`). У каждого токена случайный `jti` (`server/crypto-rust/src/main.rs:264-267`). Legacy `public.user_sessions` в сервисах больше не используется (остался только в `cmd/migrate-legacy`) | — | #706 (закрыта, PR #1034) |
| Удаление устройства не отзывает bearer token | Готово (GAP закрыт на бэке) | `revokeDevices`: запись в `auth.revoked_tokens`, `revoked_at`, `NotifyRevocation`: `backend-v2/internal/user/service.go:1110-1128` | Кнопки удаления в интерфейсе нет — см. раздел 11 | #706 (закрыта); UI — #720 |
| Access token хранится в `localStorage` | Готово (GAP закрыт) | См. 17.1 | — | #705 (закрыта) |
| Bearer token в URL WebSocket | Готово (GAP закрыт) | См. 17.2 | — | #705 (закрыта) |

## Открытые задачи области

- **#720** (mvp-go, назначена на aevuum, PR нет) — осталось целиком: на фронте нет UI завершения одной сессии. Бэк для неё готов (`DELETE /users/devices/{id}`, `backend-v2/internal/user/handler.go:601-641`), метод клиента есть (`frontend/src/services/UserService.ts:135-139`). Описание задачи устарело: «первый элемент считается текущим» уже неверно (`SessionsManager.tsx:61`). Предлагаю добавить в эту задачу кнопку «Завершить все, кроме этого» (`terminate-all`): по объёму это одна и та же работа.
- **#996** (mvp-go) — осталось целиком: нет маршрута, ссылки «Забыли пароль?» и формы. Задача блокирована #704 и отсутствием канала доставки: задача предполагает «ссылка отправлена» на email, а email сервер не хранит (`AccountSection.tsx:240-245`).
- **#997** (mvp-go) — осталось целиком. Блокирована #704.
- **#704** (бэк, **без метки mvp-go**, хотя пункт «Восстановление доступа» входит в MVP) — ничего не реализовано (`backend-v2/cmd/auth/main.go:60-80`). Не выбран канал (email/телефон/коды восстановления). Метку стоит добавить, канал — решить.
- **#407** — **можно закрыть**: у каждого токена случайный `jti` (`server/crypto-rust/src/main.rs:264-267`, коммит `c3bdbb9b`, #706). Одинаковых JWT при двух входах в одну секунду больше нет.
- **#424** — **можно закрыть**: logout берёт срок записи отзыва из claims токена (`backend-v2/internal/auth/handler.go:198-203`). Отзыв устройства берёт его из `expires_at` сессии, то есть из `exp` токена (`backend-v2/internal/user/service.go:1114-1121`). Кроме того, токен без живой строки в `auth.sessions` отклоняется независимо от TTL записи (`backend-v2/internal/platform/authctx/revocation.go:43-47`).
- **#410** — частично: токен удалённого пользователя теперь отклоняется (`revocation.go:55-57`), а `disabled_at` при проверке токена по-прежнему не учитывается (`revocation.go:37-51`). На MVP не влияет, пока нет блокировки аккаунтов.
- **#499** — по сути **можно закрыть** или сузить до теста: dev-прокси `Origin` больше не переписывает (`frontend/vite.config.ts:101-112`, коммит `26fb2b53`). Остался только пункт «тест рукопожатия через dev-proxy». К пользовательскому MVP не относится.
- **#416** — актуальна: сервер не проверяет длину `firstName`/`lastName` (`backend-v2/internal/user/service.go:136-147`), на фронте ограничение есть. Не блокер.
- **#421**, **#422** — актуальны, не блокеры MVP. Смена пароля не сериализуется (`backend-v2/internal/auth/service.go:443-465`). Вход для несуществующего имени возвращается до проверки пароля, ответ быстрее, и это даёт тайминговую утечку (`auth/service.go:180-182`).
- **#413** — актуальна (состояние QR-входа в памяти процесса, `backend-v2/internal/auth/handler.go:46-53`). В проде auth один процесс, так что для MVP не критично.
- **#1016**, **#1018** — рефакторинг (`ProfileEditForm`, `RegisterWizard`), на функциональность MVP не влияют.
- **#618** (эпик) — части области (#485, #598) закрыты. Остались #596/#597 (вне MVP). Эпик не закрывать.
- Остальные auth-задачи из open-other (#411, #417, #418, #427, #428, #430) — укрепление и документация API, в требования MVP не входят. Детально не проверялись.

## Закрытые задачи, где требование не выполнено

- **#406** (отзыв всех токенов после logout-all) и logout-all-часть **#409**. Код есть, но выключен флагом `AUTH_LOGOUT_ALL_GENERATION_ENABLED=false` во всех конфигурациях репозитория (`.env.example:112`, `docker-compose.yml:84`, `infrastructure/docker/docker-compose.v2.yml:72`, `infrastructure/kubernetes/v2/foundation.yaml:130`). Если в Amvera флаг не включён, требование в проде не выполнено: кнопка «Завершить все сеансы» отвечает ошибкой 503. Нужна ручная проверка.
- **#443** (обновлять metadata при повторной регистрации устройства) — формально выполнено (`backend-v2/internal/user/service.go:994-1012`), но фронт `POST /users/devices/register` не вызывает (`UserService.ts:129-133`, вызовов нет). Поэтому metadata и `last_active` после входа не обновляются никогда. Требование MVP «время последней активности» этим не закрыто.

## Пробелы без задачи

- Кнопка «Завершить все сеансы, кроме этого» на готовый `POST /users/devices/terminate-all` — фронт, **S** (или расширить #720).
- Реальное время последней активности: обновлять `auth.sessions.last_active` при запросах/heartbeat сокета с троттлингом. Сейчас показывается время входа — бэк, **S–M**.
- Выход из настроек и «Завершить все сеансы» не вызывают `clearAuthSession`: в памяти вкладки до перезагрузки остаются черновики, очередь исходящих, расшифрованные превью, blob-URL и ключи чатов. Ошибка `/auth/logout` проглатывается, cookie остаётся действующей (`AccountSection.tsx:45-61`, `SessionsManager.tsx:30-57`) — фронт, **S**.
- Канал восстановления доступа: привязка и подтверждение email (или иной канал), хранение, отправка. Без этого #704/#996/#997 не реализуемы в том виде, как описаны (`AccountSection.tsx:240-245`) — бэк+фронт, **M–L**, сначала нужно продуктовое решение.
- Серверная проверка длины «О себе» (на фронте 160, на сервере без ограничения) — бэк, **S** (можно присоединить к #416).

## Риски и зависимости

- **Флаг logout-all в проде.** От него зависят «Завершить все сеансы» и требование 17.2 «logout-all закрывает все сокеты». Проверить значение `AUTH_LOGOUT_ALL_GENERATION_ENABLED` в Amvera. Включать строго по `docs/prod-merge-runbook.md:70-81`, отдельным деплоем того же образа.
- **Восстановление доступа — самый крупный остаток и зависит от продуктового решения.** В аккаунте нет ни email, ни телефона. #704 без метки mvp-go, фронтовые #996/#997 ждут бэк. Сейчас забытый пароль означает потерю аккаунта, если нет другого открытого устройства для входа по QR.
- **Смена пароля не завершает другие сеансы** (`backend-v2/internal/auth/service.go:443-465`), а «завершить остальные» в интерфейсе нет. При компрометации у пользователя остаётся только logout-all, который может быть выключен флагом. В требования MVP явно не входит, но это связанный риск.
- **Устройство, сессию которого завершили, переходит на экран входа не сразу.** Сокет закрывается сервером мгновенно. Но клиент просто переподключается (рукопожатие получает 401, а браузер код ответа не показывает: `frontend/src/services/WebSocketClient.ts:180-213`). Выход на экран входа происходит только при следующем HTTP-запросе с 401 (`AuthGuard.tsx:12-23`). Нужна ручная проверка на двух браузерах после появления #720.
- **PR #995** (adal4ik, база `master`, 100 файлов) закрывает скачивание медиа сессией. Для аватаров оставлен доступ любой сессии, но `Cache-Control` становится `private` без долгого кеша: аватары будут грузиться заново, это заметно в списке чатов и профиле. Кроме того, PR направлен в `master`, а не в `dev`, поэтому в diff попадает весь `dev`. Перед ревью нужен retarget.
- **Аккаунты со старым 2FA** не могут войти паролем (`LoginForm.tsx:85-93`), остаётся только вход по QR. 2FA вне MVP, но таких пользователей стоит проверить в данных.
- **Сессия 30 дней без refresh** (`session.go:24`): по истечении срока нужен повторный вход. Для MVP приемлемо, но это стоит зафиксировать в требованиях.
- **`ALLOWED_ORIGINS="*"` в проде** безопасен для cookie (принимаются только свой хост или точный адрес), но держится на корректных `Host`/`X-Forwarded-Proto` от прокси (`session.go:110-122`). Рекомендация из #705: задать точный адрес.
