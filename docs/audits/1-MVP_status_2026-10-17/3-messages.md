# Сообщения: базовые, ответы, правка, удаление, реакции, закрепление, пересылка, выбор, форматирование, read receipts

Аудит по коду `origin/dev` @ `a465dbcd` (17.10.2026). Пути — от корня репозитория.
«Готово» — пользователь делает это в интерфейсе, фронт подключён к API, бэкенд поддерживает. Живого прогона не было: проверено чтением кода и наличием тестов (jsdom/msw на фронте, unit/integration на Go). Playwright-сценариев по сообщениям нет: в `frontend/e2e/` только фикстуры.

Итого 57 пунктов: **Готово 49, Частично 5, Нет 1, Нужна ручная проверка 2.**

## 4.1. Базовые сообщения

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Отправка текстового сообщения | Готово | Фронт: `frontend/src/features/send-message/model/useComposerSendMessage.ts:135-200` (оптимистичное сообщение + outbox) → `frontend/src/services/MessageService.ts:125-139,259` → `POST /api/v2/messages/{chatId}` пачкой (`backend-v2/cmd/chat/main.go:123`, `backend-v2/internal/chat/messages.go:92-169`, #808). Тест `frontend/src/pages/chat-thread/__tests__/sendText.test.tsx` | — | #808, #552 (закрыты) |
| Получение сообщения | Готово | WS `new_message` → расшифровка → `putThreadMessage` (`frontend/src/realtime/useServerEvents.ts:56-73`); дедуп эха — `frontend/src/entities/message/model/threadCache.ts:45-54`. Тест `incomingMessage.test.tsx` | — | — |
| Статус отправки | Готово | Часы во время отправки, ошибка с «Повторить/Отменить»: `frontend/src/entities/message/ui/MessageBubble/MessageBubble.tsx:215-283`; `sendError.test.tsx` | — | #552 (закрыта) |
| Статус доставки | Готово | Сервер: границы «доставлено до» и журнал `chats.receipt_marks` (`backend-v2/migrations/0033_receipt_marks.sql`), сдвиг при отправке в открытый сокет и при загрузке списка/ленты (`backend-v2/internal/chat/receipts.go:125-196`), событие `receipts` (`receipts.go:202-223`). Клиент: две приглушённые галочки (`MessageBubble.tsx:220-228`, `useServerEvents.ts:124-136`). Тест `receipts.test.tsx:45` | Только личные чаты: в группах событие не рассылается (`receipts.go:207`), UI показывает «отправлено» (`frontend/src/pages/chat-thread/ui/ChatThreadPage.tsx:163`). Для MVP 1:1 этого достаточно | #721, #657 (закрыты) |
| Статус прочтения | Готово | `readAt` у своих сообщений (`backend-v2/internal/chat/receipts.go:236-297`), цветные галочки (`MessageBubble.tsx:226-228`), в списке чатов — `frontend/src/entities/chat/ui/ChatListItem/ChatListItem.tsx:87` | То же ограничение по группам | #657 (закрыта) |
| Точное время прочтения | Готово | Время ставит сервер (`receipt_marks.at`, `receipts.go:78-80`). В меню своего сообщения первой строкой «Прочитано сегодня в 21:05» (`frontend/src/features/message-actions/ui/MessageActionsPopover.tsx:139,272-281`, формат — `frontend/src/shared/lib/utils/receipts.ts:92-130`). Тест `receipts.test.tsx:87` | Показывается только в меню и только в личном чате | #657 (закрыта) |
| Корректный порядок сообщений | Готово | Сервер `ORDER BY created_at` (`backend-v2/internal/chat/service.go:2143`), внутри пачки время различается на микросекунды (`service.go:2353`). Клиент сортирует стабильно (`frontend/src/shared/lib/utils/sortMessagesChronologically.ts:4-6`, `threadCache.ts:29-32`) | — | — |
| Отсутствие дубликатов | Нужна ручная проверка | Эхо отправки и WS дедуплицируются (`threadCache.ts:45-54`). Но история грузится по смещению: `getNextPageParam` = `allPages.length * 50` (`frontend/src/entities/message/model/threadQueries.ts:21-23`), а новые сообщения дописываются в первую страницу. Если пришло N новых, следующая страница с `offset=50` повторит N уже загруженных. `flattenThread` склеивает страницы без дедупа (`threadCache.ts:29-32`), лента тоже (`frontend/src/widgets/chat-messages/model/useVirtualMessagesFeed.ts:172-190`). После удаления наоборот: N сообщений будут пропущены | Шаги: открыть чат с историей больше 50 сообщений, получить 3 новых, прокрутить вверх до подгрузки и проверить, не задвоились ли 3 сообщения на стыке страниц. Исправить: дедуп по `id` в `flattenThread` (S), правильно — курсор `before=(createdAt,id)` (M) | нет задачи |

## 4.2. Ответы

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Ответ на конкретное сообщение | Готово | «Ответить» в меню (`frontend/src/features/message-actions/model/useMessageActions.ts:318-323`), `replyTo` уходит в отправке, сервер проверяет принадлежность чату (`backend-v2/internal/chat/messages.go:155-158`) | — | — |
| Отображение исходного сообщения в ответе | Частично | Плашка `frontend/src/entities/message/ui/MessageBubble/MessageReplyPreview.tsx:22-130`. Исходник берётся только из загруженной ленты (`frontend/src/widgets/chat-messages/ui/MessagesList.tsx:233`); недостающие страницы догружаются максимум дважды (`frontend/src/pages/chat-thread/hooks/useThreadMessages.ts:87-101`). Сервер отдаёт `replyPreview` с шифртекстом (`backend-v2/internal/chat/service.go:285-307`), но клиент его не использует: поиск `replyPreview` по `frontend/src` пуст | Если исходник старше ~150 сообщений, в плашке видно автора и «Сообщение» вместо текста. Нужно расшифровывать `replyPreview.content` в `processMessageForDisplay` (S) | нет задачи |
| Переход к исходному сообщению | Готово | Клик или Enter по плашке (`MessageReplyPreview.tsx:106-121`); догрузка по позиции (`frontend/src/features/jump-to-message/model/useJumpToMessage.ts`, `GET /chats/{id}/messages/{id}/position` — `backend-v2/internal/chat/routes_chats.go:56-59`) | — | #842, #553 (закрыты) |

## 4.3. Редактирование

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Изменение собственного сообщения | Готово | «Изменить» только для своего текста или подписи (`frontend/src/features/message-actions/model/messageActionRules.ts:95-103`), повторное шифрование (`frontend/src/services/MessageService.ts:587-615`) → `PUT /messages/{id}`. Сервер: только автор и участник чата, стикер править нельзя (`backend-v2/internal/chat/service.go:2433-2542`). Тест `editMessage.test.tsx` | — | — |
| Отображение признака редактирования | Готово | `isEdited = updated_at > created_at` (`service.go:2490`), «изменено» в мете (`MessageBubble.tsx:263`); WS `message_edited` (`service.go:2531`) → перечитать ленту (`frontend/src/realtime/invalidationMap.ts:31-32`) | — | — |
| Отображение времени изменения | Частично | Бэк: `updatedAt` есть в REST и WS (`service.go:2531-2536`). `updated_at` меняется только правкой (единственный `SET ... updated_at` для сообщений — `service.go:2481`; удаление ставит лишь `deleted_at`). Фронт: время правки нигде не показывается — `updatedAt` используется только для гонок (`frontend/src/entities/message/model/threadCacheActions.ts:51-56`) | Фронт: показать «изменено в ЧЧ:ММ» (title у метки или строка в меню) — S. Бэк: описать семантику `updatedAt`/`editedAt` в OpenAPI (`backend-v2/contracts/openapi/components/schemas.yaml:591-593` — без описания) | #711 (бэк); фронт — нет задачи |

## 4.4. Удаление

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Удалить сообщение для всех | Готово | `POST /chats/{id}/messages/delete` с `forEveryone` (`backend-v2/internal/chat/handler.go:575-576`, `backend-v2/internal/chat/messages.go:390-409`): только свои, всё или ничего, до 100 сообщений, WS `messages_deleted` всем (`backend-v2/internal/chat/delete_messages.go:28-141`). Клиент — `frontend/src/services/MessageService.ts:621-627`, `useMessageActions.ts:134-168`. Тесты `backend-v2/internal/chat/delete_messages_integration_test.go`, `deleteMessage.test.tsx` | Удаление чужого администратором группы — #869 (вне MVP 1:1) | #840, #173 (закрыты) |
| Удалить сообщение только у себя | Готово | `messages.hidden_messages` (`backend-v2/migrations/0031_hidden_messages.sql`). Скрытое исключено из истории, списка чатов и last message, ответов, закреплённых, поиска, избранного и общих медиа (`service.go:296,489,522,589,622,2142,3377,3589,3637`, `backend-v2/internal/chat/shared_media.go:107,150,156`). WS `messages_hidden` — только своим устройствам (`delete_messages.go:134-140`) | — | #840 (закрыта) |
| Подтверждение удаления | Готово | `frontend/src/features/message-actions/ui/DeleteMessagesDialog.tsx:25-93` — галочка «Удалить и у собеседника» / «Удалить у всех», если все выбранные свои; подключён в `ChatThreadPage.tsx:226-230` | — | #840 (закрыта) |

## 4.5. Реакции

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Поставить реакцию | Готово | Шесть быстрых реакций в меню (`MessageActionsPopover.tsx:287-311`) → `POST /messages/{id}/reactions` (`frontend/src/services/MessageService.ts:782-786`, `backend-v2/internal/chat/handler.go:911-950`) | — | — |
| Убрать реакцию | Готово | Клик по своей «пилюле» или по выбранной в меню; сервер работает переключателем (`backend-v2/internal/chat/service.go:3037`); `reactions.test.tsx` | — | — |
| Заменить реакцию | Готово | Сервер хранит одну реакцию на человека (`UNIQUE (message_id, user_id)` — `backend-v2/migrations/0022_single_user_message_reaction.sql`) и умеет `replaced`. Клиент при замене делает два запроса (`useMessageActions.ts:204-208`) и прячет промежуточное эхо (`frontend/src/entities/message/model/pendingReactions.ts`) | Идемпотентный `PUT /reactions/me` и один запрос с клиента | #566 |
| Отображение реакции | Частично | Счётчики и своя реакция при загрузке ленты — `MessageBubble.tsx:555-570`, `myReaction` в агрегате (`service.go:2941-2960`). **Дефект:** в WS `reaction_updated` нарочно нет `myReaction` (`service.go:3263-3271`), а клиент целиком заменяет им массив (`frontend/src/realtime/useServerEvents.ts:109-122`). Поэтому, как только реакцию ставит собеседник (или вы со второго устройства), ваша реакция теряет подсветку. Поля `actorId`/`change` клиент не читает | Сохранять `myReaction` из кеша или считать его по `actorId`+`change` — фронт, S. Шаги: А ставит 👍 на сообщение, Б ставит ❤️ на то же сообщение — у А 👍 перестаёт быть выделенной | нет задачи |
| Отображение автора реакции | Нет | API отдаёт только `emoji/count/myReaction` (`service.go:2859-2863`), в UI авторов нет (`MessageBubble.tsx:98-140`). Бэкенд-эндпоинт — в открытом PR #1029 (не влит, CHANGES_REQUESTED), фронт не начат | Бэк: довести и влить #1029. Фронт: #998 (подсказка, окно со списком) | #709 + PR #1029, #998 |

## 4.6. Закрепление

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Закрепить сообщение (у себя / у всех) | Частично | «У всех» есть: `POST /chats/{id}/pins/{messageId}` (`backend-v2/internal/chat/routes_chats.go:40-48`, `service.go:3450-3510`), WS `message_pinned` всем; клиент — `useMessageActions.ts:261-290`. «У себя» нет: таблица одна, общая (`messages.pins`), в запросе нет параметра области (`frontend/src/services/MessageService.ts:768-774`) | Бэк — `messages.personal_pins` и `scope` (#710), фронт — выбор области (#999) | #710, #999 |
| Открепить сообщение | Готово | `DELETE /chats/{id}/pins/{messageId}` (`service.go:3523-3570`), пункт «Открепить», «Открепить всё» с подтверждением (`frontend/src/widgets/pinned-messages/ui/PinnedMessagesView.tsx:49-69,124-139`) | — | — |
| Отображение закреплённого сообщения | Готово | Плашка-навигатор (`frontend/src/features/pinned-messages/ui/PinnedMessagesNavigator.tsx`), экран списка (`PinnedMessagesView.tsx`), булавка в мете пузыря (`MessageBubble.tsx:258-262`). Тест `pinMessage.test.tsx` | Автопереключение плашки при прокрутке — улучшение, не требование MVP | #170 (закрыта), #1057 |
| Переход к закреплённому сообщению | Готово | Клик по плашке → `jumpRequest` (`frontend/src/features/pinned-messages/model/usePinnedNavigator.ts:37-54`) → `MessagesList.tsx:145-152` с подсветкой; починено 17.10 в `e80fb296` (#1024, PR #1025) | — | #1024 (закрыта) |

## 4.9. Пересылка

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Переслать одно сообщение | Готово | «Переслать» → выбор чата → плашка над полем ввода → отправка (`useMessageActions.ts:298-306`, `frontend/src/features/forward-messages/model/useForwardSend.ts:56-110`); тест `forwardMessage.test.tsx` | — | #93 (закрыта) |
| Переслать несколько сообщений | Готово | Режим выбора → «Переслать» (`frontend/src/widgets/chat-composer/ui/ChatSelectedMessagesActions.tsx`); одна пачка до 100 сообщений, всё или ничего (`MessageService.ts:665-699`, `backend-v2/internal/chat/messages.go:59-61,114-122`) | — | #93, #808 (закрыты) |
| Переслать текст | Готово | `prepareForward` → `prepareText` с `forwardedFrom` и форматированием (`MessageService.ts:733-742`) | — | — |
| Переслать медиа | Частично | Фото, видео, файлы и голосовые расшифровываются из памяти и перезаливаются под ключом целевого чата (`MessageService.ts:714-731`). **Стикеры и GIF:** они в `MEDIA_MESSAGE_TYPES` (`MessageService.ts:29`), поэтому `prepareForward` перезаливает их как зашифрованную загрузку (`mediaEncrypted: true` — `MessageService.ts:176-229`). Сервер для `sticker/gif` требует ссылку каталога без шифрования (`backend-v2/internal/chat/service.go:247-251`, `messages.go:219-224`) — значит, ответит 400 `invalid_media_metadata`. «Переслать» также показывается у звонков и у сообщений с недоступным медиа (`messageActionRules.ts:105`), а сервер такую отправку не примет (`backend-v2/internal/chat/message_types.go:16-25`, `messages.go:213-216`) | Стикеры и GIF пересылать как `sendCatalogMedia` с `forwardedFrom` (S); скрыть «Переслать» у звонков и недоступного медиа (S). Проверить вживую | нет задачи |
| Отображать исходного автора | Готово | Автора подставляет сервер по `forwardedFrom` с учётом правила «Пересылка» (`backend-v2/internal/chat/service.go:2757-2895`); «Переслано от» со ссылкой на профиль (`MessageBubble.tsx:418-441`). Тест `backend-v2/internal/chat/forwarded_from_test.go` | — | #169, #358, #785, #726 (закрыты) |
| Сохранять порядок пересылаемых | Готово | Сортировка по времени при выборе (`frontend/src/features/forward-messages/model/forwardStore.ts:40`), комментарий первым (`MessageService.ts:680-696`), время на сервере растёт с шагом в микросекунду (`service.go:2353`). Тест `backend-v2/internal/chat/send_batch_test.go` | — | #93 (закрыта) |
| Корректная работа с E2E | Готово | Текст берётся расшифрованным и шифруется ключом целевого чата, медиа шифруются заново (`MessageService.ts:647-743`); нерасшифрованное переслать нельзя (`MessageService.ts:710-712`, `messageActionRules.ts:105`) | Живая проверка на реальных ключах | — |

## 4.10. Выбор нескольких сообщений

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Включить режим выбора | Готово | «Выбрать» в меню (`MessageActionsPopover.tsx:232-238`, `useMessageActions.ts:292-296`) | — | — |
| Выбрать несколько сообщений | Готово | Переключение с лимитом 100 (`frontend/src/features/message-actions/model/useMessageSelection.ts:13-40`), счётчик (`ChatSelectedMessagesActions.tsx`) | — | — |
| Отменить выбор | Готово | «Отмена» и Escape (`ChatSelectedMessagesActions.tsx`, `useMessageActions.ts:411-414`) | — | — |
| Групповое действие: переслать | Готово | `ChatThreadPage.tsx:232-238` → `handleForward` | — | — |
| Групповое действие: удалить (свои у себя/у всех) | Готово | Одним запросом: свои — с выбором «у всех», при смешанном выборе — только у себя (`DeleteMessagesDialog.tsx:38-42`, `useMessageActions.ts:134-144`, сервер `delete_messages.go:87-105`) | — | #840 (закрыта) |

## 5. Форматирование текста

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Жирный | Готово | Меню форматирования в поле ввода (`frontend/src/shared/ui/RichTextInput/ComposerContextMenu.tsx:41-78,283-298`), Ctrl+B; entities хранятся и проверяются на сервере (`backend-v2/migrations/0028_message_entities.sql`, `backend-v2/internal/chat/entities.go:135`), в E2E-чатах entities лежат в конверте (`MessageService.ts:155-158`); отображение — `frontend/src/entities/message/ui/MessageBubble/MessageContent.tsx` | — | #656, #915 (закрыты) |
| Курсив | Готово | То же, Ctrl+I | — | #656 |
| Подчёркивание | Готово | То же, Ctrl+U; отображение `MessageContent.tsx:118-132` | — | #656 |
| Зачёркивание | Готово | Ctrl+Shift+X (`frontend/src/shared/ui/RichTextInput/formatShortcuts.ts:14-18`) | — | #656 |
| Моноширинный текст | Готово | Ctrl+Shift+M, отображение `MessageContent.tsx:110` и блоки кода `CodeBlock.tsx` | — | #656 |
| Ссылка | Готово | Ctrl+K, окно `LinkDialog.tsx`; сервер пропускает только http/https (`entities.go:150-160`); отображение `MessageContent.tsx:141` | — | #656, #915 |
| Цитата | Готово | `toggleQuote` (`ComposerContextMenu.tsx:255-260,308-314`), `blockquote` на сервере (`entities.go:164-190`), отображение `MessageContent.tsx:173-179` | — | #656 |
| Spoiler | Готово | Ctrl+Shift+H, «Скрытый текст»; в сообщении — «пыль» и показ по нажатию (`MessageContent.tsx:60-72,152`) | — | #656 |
| Изменение регистра (верхний / нижний / с заглавной) | Готово | `ComposerContextMenu.tsx:316-337` | — | #1000 (закрыта, PR #1004) |
| Доступ к форматированию на телефоне | Нужна ручная проверка | Меню открывается только по событию `contextmenu` (`ComposerContextMenu.tsx:179-180`): на iOS Safari долгое нажатие в редактируемом поле его обычно не вызывает. Другой точки входа (кнопки, панели при выделении) нет | Проверить на iPhone и Android. Если не открывается — добавить кнопку или панель при выделении (фронт, S–M) | нет задачи |

## 17.3. Read receipts

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Подтверждённый messageId не отправляется повторно | Готово | `requestedRef` в `frontend/src/pages/chat-thread/hooks/useMarkAsRead.ts:12,37-55`; отбор только непрочитанных выше границы `lastReadAt` (`frontend/src/widgets/chat-messages/model/unread.ts:167-184`). Тест `markReadOnScreen.test.tsx:102` | См. пробел про временные id из outbox | #919 (закрыта) |
| Несколько read-событий батчатся | Готово | Окно 300 мс (`useMarkAsRead.ts:8,52`), до 500 id за запрос (`backend-v2/internal/chat/service.go:1278`) | — | #919 |
| Rerender не создаёт повторных запросов | Готово | Состояние в `useRef` вне рендера; эффект зависит от `lastSeenIndex` (`useVirtualMessagesFeed.ts:403-410`) | — | #919 |
| Refetch не создаёт повторных запросов | Готово | После перечитывания отсекает граница `chat.lastReadAt` (`frontend/src/entities/chat/model/readMark.ts:34,55`, `unread.ts:180`) | Исключение: сообщение из outbox, восстановленное в ленту при перечитывании, получает `senderId: ''` (`frontend/src/entities/message/model/threadQueries.ts:47`, `threadCache.ts:76`) и проходит фильтр «чужое» (`useMarkAsRead.ts:43`). Его `temp-…` id уйдёт в `/messages/read`, сервер ответит 400 на всю пачку (`backend-v2/internal/chat/messages.go:490-494`), и пачка будет повторяться | нет задачи (S) |
| Reconnect не создаёт лавины | Готово | После reconnect грузится только свежая страница (`frontend/src/realtime/resyncAfterReconnect.ts:34-60`), повторно её отсекают `requestedRef` и граница | Подтвердить вживую на вкладке Network | — |
| Backend учитывает конкретные messageIds | Готово | Все id проверяются на принадлежность чату; граница — самое новое из учтённых чужих, а не «сейчас»; назад не двигается (`backend-v2/internal/chat/service.go:1297-1362`, `messages.go:460-507`). Тест `backend-v2/internal/chat/mark_read_integration_test.go` | — | #506 (закрыта, `78825e02`) |
| Точное время прочтения сохраняется и показывается | Готово | Журнал `chats.receipt_marks` (`0033_receipt_marks.sql`), `readAt` в сообщениях (`receipts.go:236-297`), показ — `MessageActionsPopover.tsx:272-281`. Тест `backend-v2/internal/chat/receipts_integration_test.go` | Модель — граница, а не отметка на каждое сообщение: время старых сообщений — момент, когда граница прошла через них | #657 (закрыта) |

## 20. Известные GAP (область сообщений)

| Пункт | Статус | Доказательство | Что осталось | Задача/PR |
|---|---|---|---|---|
| Read receipts работают некорректно | Готово (исправлено) | Сервер учитывает id (#506), есть границы и журнал (#657), прочтение по мере показа на экране и не в фоне (#919: `dedc34b8`, `bb835c5f`) | Живая проверка двумя браузерами | #506, #657, #919 (закрыты) |
| Есть повторные `/messages/read` | Готово (исправлено) | `useMarkAsRead.ts` (дедуп + батч), `unread.ts:167-184` (граница); тест `markReadOnScreen.test.tsx:102` | Пробел с temp-id (выше); живая проверка на Network | #919 (закрыта) |

## Открытые задачи области

- **#708** — можно закрыть: всё реализовано в #840 (PR #870, `bde3a249`). Есть скрытие у себя (`backend-v2/migrations/0031_hidden_messages.sql`), пакетный `POST /chats/{id}/messages/delete` с `forEveryone`, атомарный, до 100 сообщений (`backend-v2/internal/chat/delete_messages.go`). Скрытое исключено из истории, поиска, закреплённых, избранного, превью ответа и last message (строки — в 4.4). WS `messages_hidden` получают только свои устройства. Есть OpenAPI (`backend-v2/contracts/openapi/paths/chats.yaml:649-676`) и интеграционные тесты (`delete_messages_integration_test.go`). Одна оговорка: повтор `forEveryone` по уже удалённому даёт 404, а не 200. Вреда нет, но если нужна строгая идемпотентность — это отдельная мелочь.
- **#711** — для пользователя не блокер: `updatedAt` уже фактически время правки (`service.go:2481` — единственное место, где его меняют), отдаётся в REST и WS. Остаётся описать семантику (или ввести `editedAt`) в OpenAPI и добавить contract-тесты. Показ времени на фронте сюда не входит — задачи на него нет.
- **#710** (bryack) — не начато, PR нет. Решение по API зафиксировано в комментарии p-force 07.10: `scope=chat|personal`, `isChatPinned`/`isPersonalPinned`, `messages.personal_pins`, WS `message_personal_pinned` только владельцу. Блокирует #999.
- **#999** — не начато, зависит от #710. Противоречие: задача предлагает флаг `forEveryone`, а #710 решил через `scope=personal|chat`. Перед стартом исправить описание.
- **#709** — бэкенд в PR #1029 (AnumSmart): `GET /messages/{id}/reactions/users?emoji=&cursor=&limit=`, курсор по `(created_at,user_id)`, приватность аватара. Статус CHANGES_REQUESTED. MaxDon26 14.10 блокировал: путь не подключён к корневому контракту и нет тестов. В текущем diff `api-v2.yaml` подключён и тесты добавлены, но p-force 16.10 пишет, что заявленные сценарии тестами не покрыты. Миграция названа `0040_reactions_authors_read_index.sql`, в шапке файла написано `0039`; в dev уже есть `0040_settings_defaults.sql` и `0041_personal_chat_mute.sql`. Раннер учитывает миграции по имени файла, так что конфликта нет, но номер стоит поднять до 0042. PR закрывает только бэкенд-часть «автора реакции».
- **#998** — не начато, ждёт #1029. В описании `getReactions(messageId)`, а по контракту PR `emoji` обязателен — для вкладки «Все» понадобится запрос на каждую эмодзи. Описание задачи стоит обновить.
- **#566** — частично закрыта другими изменениями: «одна реакция на человека» обеспечивает сервер (`0022_single_user_message_reaction.sql`), замену одним запросом он поддерживает (`replaced`). Осталось: идемпотентный `PUT /reactions/me` и уйти на клиенте от двух запросов при замене (`useMessageActions.ts:204-206`), после чего убрать `pendingReactions.ts`. Для MVP не блокер.
- **#511** — не сделано: проверяется только длина и HTML-символы (`backend-v2/internal/chat/service.go:3052`), произвольный текст принимается как реакция. Интерфейс шлёт только 6 быстрых реакций, поэтому пользователь этого не видит; это гигиена API.
- **#1057** — улучшение (автопереключение плашки закреплённых при прокрутке), требованию 4.6 не нужно.
- **#616** (эпик) — список устарел: перечисленные #552, #173, #170, #169, #593 закрыты. Рефакторинги #1010, #1011, #1015, #1017, #1022 функциональность не меняют.

## Закрытые задачи, где требование не выполнено

- **#93** (пересылка) и **#973** (стикеры и GIF без `media.uploads`), вместе с PR #976: после перехода стикеров и GIF на каталог их пересылка, судя по коду, ломается. `prepareForward` перезаливает их как зашифрованную загрузку (`frontend/src/services/MessageService.ts:29,716-731`), а сервер требует незашифрованную ссылку каталога (`backend-v2/internal/chat/service.go:247-251`). Нужна ручная проверка: переслать стикер в другой чат.
- Других расхождений по закрытым задачам области (#506, #599, #655, #656, #657, #721, #840, #915, #919, #1000, #169, #170, #173, #358, #785, #726, #808, #1024) не нашёл — требования в коде выполнены.

## Пробелы без задачи

- Подсветка своей реакции пропадает после чужого `reaction_updated`: WS без `myReaction` (`service.go:3263-3271`), клиент заменяет массив целиком (`useServerEvents.ts:115-119`) — фронт, S.
- Пересылка стикеров и GIF (как каталожных, с `forwardedFrom`), плюс скрыть «Переслать» у звонков и у сообщений с недоступным медиа (`messageActionRules.ts:105`) — фронт, S.
- Показ времени редактирования («изменено в ЧЧ:ММ») — фронт, S.
- Текст исходника в ответе на старое сообщение: расшифровывать `replyPreview` с сервера, а не только искать в загруженной ленте — фронт, S.
- Дубли или пропуски при подгрузке истории по `offset` после новых или удалённых сообщений: дедуп в `flattenThread` — фронт, S; курсорная пагинация `before=(createdAt,id)` — бэк + фронт, M.
- Временный id из outbox попадает в `/messages/read` (`senderId: ''` у восстановленных сообщений: `threadQueries.ts:47`, `threadCache.ts:76`) — фронт, S: отсекать `tempId`/`status` в `useMarkAsRead`/`selectReadUpTo` и ставить `senderId` текущего пользователя.
- Форматирование на телефоне (если ручная проверка подтвердит, что меню не открывается на iOS) — фронт, S–M.
- Премиум на клиенте копит несколько реакций (`useMessageActions.ts:184,204`), а сервер держит одну на человека (`0022_single_user_message_reaction.sql`): оптимистичный показ расходится с ответом — фронт, S.

## Риски и зависимости

- **Цепочки:** «закрепить у себя» = #710 (бэк) → #999 (фронт), сначала согласовать контракт (`scope` против `forEveryone`). «Автор реакции» = PR #1029 → #998. Обе цепочки не начаты на фронте, а бэкенд-части либо в ревью, либо без PR.
- **В группе обычный участник видит «Закрепить»**, но сервер отвечает 403 (`backend-v2/internal/chat/service.go:3462`), и показывается тост «нет прав администратора» (`useMessageActions.ts:273-285`). После #999 пункт «только для себя» это закроет; до того — шероховатость UX.
- **Доставка и прочтение — только в личных чатах** (`receipts.go:202-207`, `ChatThreadPage.tsx:163,174`). Для MVP 1:1 это нормально, но если группы войдут в MVP, понадобится отдельная модель «прочитано N из M».
- **Правка или удаление одного сообщения перечитывает всю загруженную историю** (`invalidationMap.ts:31-36`) с `offset`-страницами. Это усиливает риск дублей и пропусков из 4.1 и даёт заметную нагрузку в длинных чатах.
- **Время приходит текстом Postgres** (`::text`, вид `2026-10-17 12:34:56.123456+00`) и разбирается через `Date.parse` (`unread.ts:40-43`). В Chrome это работает; в Safari такой формат исторически разбирался плохо. Если `lastReadAt` не разберётся, граница прочитанного перестанет работать и после перезагрузки вернутся повторные `/messages/read`. Проверить в Safari/iOS (касается всего приложения, не только сообщений).
- **Автотестов на живом стеке нет:** Playwright по сообщениям отсутствует, всё проверено на jsdom/msw и Go-тестах. Перед выпуском нужен ручной проход двумя браузерами: галочки и время прочтения, отсутствие повторных `/messages/read`, реакции двух пользователей, пересылка стикера, подгрузка истории после новых сообщений.
- **Ядро MVP 1:1 в области готово:** отправка, статусы, ответы, правка, удаление у себя/у всех, пересылка текста и файлов, выбор, форматирование, read receipts. Блокирующих для MVP остатков два: личное закрепление и автор реакции. Остальное — дефекты объёма S.
