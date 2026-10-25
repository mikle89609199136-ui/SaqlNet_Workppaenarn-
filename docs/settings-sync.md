# Синхронизация настроек (#1041)

## Стратегия и срок сходимости

Канонический источник — `GET /api/v2/users/settings`, включая privacy. WebSocket и транспорт вкладок передают только инвалидацию, после которой клиент заново читает сервер. Применение не зависит от открытого экрана настроек: подписки находятся в RootLayout/useServerEvents.

При исправных сети и WebSocket изменение применяется после commit, окна объединения сигналов 50 мс и одного GET; целевой бюджет — 2 секунды. Резервный GET выполняется каждые 30 секунд в видимой вкладке: потерянное событие сходится за 30 секунд плюс время GET. Focus, переход в visible, online, pageshow и подключение/переподключение WS запускают чтение сразу с тем же окном 50 мс. Браузер может задерживать фоновые таймеры; для спящей/закрытой/offline вкладки срока доставки нет, она перечитывает состояние при возвращении. Ошибка GET сохраняет последний подтверждённый выбор и повторяется следующим сигналом/резервным циклом.

## Событие и публикация

Миграция `0043_settings_changed.sql` ставит AFTER UPDATE trigger на `users.settings`. Он сравнивает account-wide JSON sections и folders через IS DISTINCT FROM. Canonical, bulk и старые section writers получают одинаковое поведение; read, ensure/default row, no-op и passcode-only update события не создают. PostgreSQL выпускает NOTIFY только после успешного commit; rollback, constraint/validation failure ничего не публикуют.

Канал PostgreSQL: `crane_settings_changed`. Chat service слушает его существующим LISTEN transport и отправляет всем WS-подключениям единственного владельца:

```json
{"type":"settings_updated","payload":{"userId":"<owner UUID>","version":1}}
```

`version` — версия формата события, а не revision настроек. Relay проверяет UUID/версию и пересобирает payload из разрешённых полей; settings/privacy JSON и соседи по чату в рассылку не попадают. Потеря NOTIFY при переподключении listener компенсируется резервным чтением клиентов. После deploy требуется применить миграцию и обновить chat service; HTTP API совместим с прежними клиентами.

После успешного PUT фронтенд также отправляет `{userId, version: 1}` через BroadcastChannel `craneapp:settings-invalidation:v1` и одноразовый storage signal с nonce. Получатель проверяет владельца и версию. Ни настройки, ни токены не передаются, чтение не порождает новую рассылку. При недоступности обоих browser transports остаются WS и резервное чтение. Сигналы WS/вкладок/focus объединяются, чтобы один commit не вызывал несколько GET.

## Конкурентные изменения и аккаунты

- В пределах вкладки settings и privacy PUT сериализованы по порядку вызова, включая разные экземпляры hooks. На сервер уходит только flat patch.
- Между устройствами/вкладками действует порядок сериализации записей в PostgreSQL: последнее сохранение одного поля побеждает, разные поля сохраняются независимо (#454/#1047). CAS/revision/ETag не добавлены: клиент не устанавливает response PUT как полный снимок и не отправляет старый полный объект.
- Пока локальные записи pending, инвалидация не перетирает optimistic overlay. После последней записи выполняется свежий GET. Ошибка удаляет только собственный слой; соседний pending/successful выбор не откатывается вместе с ним.
- Любая новая инвалидация отменяет старый query перед чтением. Query потребляет AbortSignal и проверяет owner/session после HTTP; даже service без физического abort не может установить поздний ответ. Поздний PUT response игнорируется как snapshot, язык из его patch повторно не применяется callback-ом.
- Ключ query и mutation — `['user', 'settings', ownerId, sessionEpoch]`. Logout/login создаёт новую эпоху даже для того же аккаунта. Очередь старого владельца не отправляет новые PUT после switch, callbacks/rollback не затрагивают новый кеш.
- Cookie и localStorage общие для вкладок одного origin. Если другая вкладка меняет сохранённого владельца/выходит, текущая сбрасывает in-memory identity/cache и перезагружается под новой сессией, сохраняя новую запись login storage. Изменение preferences самого владельца reload не требует.

## Применение и границы

Подтверждённый кеш применяет theme/palette/accent, размеры текста/чата, message visibility/grouping, avatar shape, язык и notification policy #725. `theme: system` сохраняется отдельно от resolved light/dark; каждое устройство слушает собственную ОС. Маленькая ранняя projection из #728 хранит ownerId и только оформление/язык; она записывается вне pending mutations, проверяется startup-script и удаляется при смене владельца/logout. Правила privacy и полные settings на диск не проецируются.

Push permission/subscription и voice volume остаются устройству/браузеру. Установка account-wide notifications не включает разрешения браузера и не меняет громкость голосовых. Другие ресурсы (chat mute/preview, privacy exceptions, devices, block lists) имеют собственные API/механизмы свежести; это событие не является их полным snapshot.

## Проверка

```sh
cd backend-v2
go test ./...
go test -tags=integration -count=1 ./internal/user
cd ../frontend
npm test
npm run api:check
npm run build
npm run check:cycles
npx playwright test -c playwright.settings-sync.config.ts
```

Browser scenarios требуют изолированный локальный backend :8080 с миграциями и Vite :3000. Проверяется реальный путь UI → PUT → PostgreSQL commit/NOTIFY → WS → GET → DOM: два устройства (раздельные browser contexts), две вкладки владельца и другой аккаунт. Дополнительно проверены offline/reconnect, system с разными ОС, язык вне его раздела, notification switch, независимая voice volume, startup-script с блокировкой app bundle и account switch. Снимок и CSS-проверки подтверждают тему/масштаб текста после синхронизации. Во втором сценарии WS вкладок перехвачен без server delivery: отдельно проверяются BroadcastChannel (storage signal блокируется) и storage fallback (BroadcastChannel недоступен).

HTTP 500 в browser scenario имитируется для проверки UI rollback; отсутствие событий при реальном rollback/invalid update/no-op проверяется Go integration test с PostgreSQL LISTEN. Unit tests проверяют поздние GET, очередь settings/privacy, rollback слоёв, изоляцию owner/session, версию события, объединение сигналов и focus/online/30-second recovery. Реальная OS notification/VAPID delivery в эту проверку не входят. Общий app TypeScript-check сохраняет ранее существовавшие ошибки DTO/Node typings; новые модули проверяются отдельно и не подменяются пустым root referenced-project check.

Локальная приёмка 23 октября 2026: 274 файла / 2470 Vitest tests, 28 API contract tests; Go unit suite и весь user integration package на PostgreSQL. Пройдены 2 новых browser scenarios и регрессии #728 (5 сценариев, неизменные screenshot-эталоны) / #725 (1 сквозной сценарий), production build, cycle check и lint изменённых frontend-файлов без ошибок. Сравнение app TypeScript с origin/dev дало те же 223 исходные ошибки, без новых диагностик; browser spec/config отдельно проходят строгую типизацию.
