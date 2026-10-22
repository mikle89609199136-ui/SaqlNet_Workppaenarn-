# Уведомления клиента: policy и приёмка #725

23 октября 2026. Клиент применяет [каноническую модель](notification-settings.md) N/S/C и [personal mute](personal-chat-mute.md). Серверная миграция, push delivery и `silent` service worker уже реализованы в #1042; эта задача их не дублирует и не меняет backend/API.

## Источник предпочтений

`entities/user/model/notificationPolicy.ts` читает только канонический query cache. `profileStore.settings` и localStorage не разрешают звук до получения settings. Нет данных, неуспешный GET или невалидный присутствующий boolean означают запрет. В валидном частичном серверном object отсутствующий flag получает общий default true. Старые aliases в клиентскую effective policy не возвращаются.

N=false маскирует S/C, не меняя сами preferences, push subscription, permission, unread/read receipts, входящее состояние звонка или звук уже идущего разговора. S и C независимы. Сохранение отправляет только изменённое поле. Выключение применяется оптимистично; включение соответствующего звука/общего допуска разрешается после commit. Ошибка возвращает прежнее состояние. Пока PUT/refetch выполняются, три account switch не запускают повторную запись; push/permission/voice volume остаются отдельными действиями устройства.

Для нового message alert настройки перечитываются с сервера; pending settings write или ошибка проверки отменяют именно это оповещение. Оно не ставится в очередь на включение/возврат сети. Перед допуском входящего звонка свежие settings читаются параллельно с caller profile. Если чтение не удалось, состояние звонка остаётся доступным, но автоматический alert этой попытки не запускается. Изменение уже полученных query preferences останавливает запрещённый рингтон; повторные пачки/разблокировка autoplay тоже проверяют актуальный допуск.

## Канал доставки

Foreground — документ видим и имеет focus. URI активного чата сравнивается с `/chats/{chatId}`. Оповещения своим сообщениям и «Избранному» не создаются.

| Состояние                                          | Новое сообщение                                                | Входящий звонок                                                |
| -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| N=false                                            | Нет alert/звука                                                | Нет OS alert/рингтона; call state сохраняется                  |
| Foreground, активный чат                           | Без дубля alert/звука                                          | Обычный call UI; локальный рингтон по C                        |
| Foreground, другой чат/раздел                      | Короткий Web Audio по S                                        | Обычный call UI; локальный рингтон по C                        |
| Background, permission=granted, push не доставляет | Browser fallback, `silent=!S`                                  | Browser fallback, `silent=!C`, без второго локального рингтона |
| Скрытая вкладка, push=on                           | Только существующий service worker                             | Только существующий service worker                             |
| Background, permission=default/denied/unsupported  | Нет OS alert и обходного Web Audio                             | Нет OS alert и обходного Web Audio                             |
| Видимая вкладка без focus, push=on                 | Fallback: сервер считает подписку видимой и не отправляет push | Такой же fallback                                              |

Короткий foreground message sound не требует Notification permission: это звук внутри открытого активного приложения. Он всё равно требует N/S, unmuted chat и другого активного чата. Background отказ браузера не обходится отдельным звуком. Заблокированный autoplay короткого сигнала не воспроизводится позже по чужому клику. В рингтоне сохраняются немедленная первая пачка, cleanup и recovery #1001; recovery не может обойти новый запрет N/C или смену call state.

В открытом приложении звук звонка принадлежит одному каналу: foreground — существующий ringtone, background — ОС. На смену видимости и settings реагирует `CallProvider`; call cancel/accept/end закрывает fallback этой комнаты. Никакая настройка уведомлений не запрещает сам разрешённый сервером звонок и не меняет conversation audio.

## Mute, preview и отмена отложенного эффекта

Меню чата теперь содержит «Отключить уведомления» / «Включить уведомления», кроме «Избранного». Используются POST `{}` и DELETE `/chats/{id}/mute`: UI toggle задаёт бессрочный mute; временные значения backend по-прежнему поддерживает. Список, архив и detail обновляются оптимистично. Ошибка возвращает только mute-поля затронутого чата, сохраняя новые сообщения, unread и соседние preferences. Итог подтверждается refetch. Существующий quiet badge учитывает expiry по timer, без обязательного нового сообщения; невалидный timestamp не снимает mute.

Mute подавляет message alerts и S, но не звонки/пропущенные звонки. Pending mute запрещает новое оповещение до подтверждения; старый ответ не снимает optimistic mute. Для допуска/preview details перечитываются через canonical chat query перед decrypt и непосредственно перед показом. Чужой/недоступный chat, ошибка проверки mute или блокировка закрывают допуск. Pending preview write принудительно использует безопасный текст, даже если GET ещё возвращает старое разрешение. Скрытый preview не запускает decrypt для системного текста; после decrypt повторно проверяются preview/mute, account identity, foreground, push и N. Цифротекст, undecryptable placeholder и сериализованный payload не выдаются в Notification body. Разрешённый plaintext ограничен 120 символами.

Call notification создаётся по валидированному FSM incoming после room/participant/direct-chat/block checks #854. Имя приходит из проверенного профиля/чата; сырой `call_incoming.fromName` не становится системным текстом. Итог answered/outgoing не создаёт message sound; missed incoming — отдельное тихое оповещение, независимо от personal message mute. При logout/account switch поздний decrypt или call validation не разрешает alert прежнего владельца. Уже созданные fallback закрываются при общем запрете/выходе; отмена звонка закрывает notification комнаты.

## Разрешение и несколько вкладок

`BrowserNotificationPermission` показывает состояние браузера и позволяет запросить permission по нажатию даже без поддержки/настройки Web Push. При denied предлагает изменить разрешение сайта, не повторяет запрос при загрузке. Существующие push UI и permission flow #882 сохранены; global N не подписывает и не отписывает устройство.

Перед background fallback выполняется короткий owner-scoped BroadcastChannel probe (75ms). Активная вкладка того же аккаунта имеет приоритет даже при разном порядке доставки сокета. Другая учётная запись не отвечает. Web Locks и bounded ledger сериализуют claim одного события в нескольких вкладках: до 512 идентификаторов за 5 минут. На диске только owner/event id и время, без plaintext, ключей или settings. Claim не удерживает lock во время HTTP/decrypt. В окружении без BroadcastChannel/Web Locks/storage остаётся доступный уровень suppression; строгая межвкладочная гарантия при недоступных browser primitives не обещается.

Alert presence/dedup transport не передаёт preferences. Доставка изменения settings всем открытым клиентам, focus/reconnect и конкурентные settings writes реализованы отдельным [транспортом #1041](settings-sync.md); alert gate читает обновляемый им канонический кеш.

## Проверки

Unit/integration coverage включает N/S/C, mute/expiry, active chat, три значения permission, push suppression, независимость C от S/M, optimistic enable/rollback, mute rollback без потери unread, failed settings/chat reads, поздний decrypt после off/logout, повторный event, raw call без validation, missed call и очистку рингтона/звукa. Регрессия отдельно проверяет смену видимости во время чтения: подписка сообщений не перезапускается из-за смены call/foreground state.

```sh
cd frontend
npm test
npm run api:check
npm run check:cycles
npm run build
npx playwright test --config playwright.notifications.config.ts
```

Browser test требует изолированный локальный backend :8080 и Vite :3000. Он создаёт два временных аккаунта, проходит UI cloud backup, отправляет настоящие E2E messages через WebSocket, сохраняет N/S через UI и проверяет mute menu/API, preview и звонок через штатный callStore/signaling. Две вкладки получателя проверяют единичное уведомление и приоритет активного чата. Web Audio работает нативно с `--mute-audio`, чтобы прогон не звучал на рабочем столе. Видимость/focus и OS Notification renderer/permission перехвачены для воспроизводимости; payload и `silent` проверяются, фактический звук/интерфейс ОС этим тестом не подтверждаются. На локальном headless macOS Permissions API возвращает granted, а native Notification.permission — denied; это ограничение тестовой среды не обходится в production коде.

Service worker sound matrix и server notification policy покрыты проверками #1042. Реальная внешняя push-доставка/VAPID не заменяется имитацией и не объявляется проверенной этим локальным browser test.

Локальная приёмка: 271 файл / 2430 тестов Vitest, 28 контрактных проверок, неизменность regenerated API types, production build, отсутствие циклов и lint изменённых файлов без ошибок. Полный browser scenario на реальном стенде прошёл, включая message/call/mute/preview и две вкладки. Общий app TypeScript-check остаётся с прежними ошибками DTO/Node typings в проекте; новые модули policy/permission/delivery не добавили ошибок. Корневой `npm run typecheck` не используется как замена проверки referenced app project.

Синхронизация канонического кеша между открытыми клиентами реализована в #1041: [событие, сходимость и правила конкурентных записей](settings-sync.md). Pending notification gate использует ключ текущего owner/session и не блокирует нового владельца незавершённой записью прежнего.
