# Проверка Media download и object storage (#718)

## Воспроизводимый прогон

Нужны Go из `backend-v2/go.mod` и запущенный Docker. Тест сам поднимает
PostgreSQL со всеми миграциями и отдельный MinIO с приватным бакетом.
MinIO собирается из исходников той же версии, что в `Dockerfile.prod`, по
`backend-v2/cmd/edge/testdata/minio.Dockerfile`: публичные готовые образы больше
не доступны. Первый прогон скачивает Go dependencies и собирает образ,
повторные используют Docker build cache. Версия и тестовые credentials заданы в тесте; production secrets и внешний
стенд не требуются. Контейнер MinIO удаляется после прогона, PostgreSQL
убирает testcontainers/Ryuk.

Из корня репозитория:

```bash
cd backend-v2
go test -tags=integration ./cmd/edge -run '^TestMediaStorageContract$' -count=1 -v
```

Короткий прогон с детектором гонок (без объектов по 100 МиБ):

```bash
go test -short -race -tags=integration ./cmd/edge -count=1
go test -tags=integration ./internal/media
```

Проверка клиентского контракта из корня:

```bash
npm --prefix frontend run api:types
npm --prefix frontend run api:check
```

Тест включён в существующий backend CI с тегом `integration`.
Он проходит по реальному HTTP через маршруты и reverse proxy edge,
`originGuard`, media handler, ACL, PostgreSQL и SigV4-клиент MinIO.
Только проверка подписи токена и отзыва сессии заменена тестовым verifier/checker;
полный жизненный цикл сессий покрыт тестами #986.

## Проверяемое поведение

- Все 11 разрешённых plain MIME проходят JSON data URL и multipart upload,
  затем GET/HEAD и Range. Сравниваются байты, статус, `Content-Type`,
  `Content-Length`, `Content-Range`, `Accept-Ranges`, `nosniff` и CORS.
  HEAD возвращает заголовки GET без тела, Range даёт 206; неверный диапазон —
  416 без тела. `Content-Range` у 416 передаётся, если его вернул storage.
- Каталог MIME проверяется по объявленному типу, без распознавания содержимого.
  HTML, SVG, JavaScript и неизвестный тип не принимаются plain upload (415).
  Уже сохранённые legacy-объекты таких типов выдаются как
  `application/octet-stream`, `Content-Disposition: attachment` и `nosniff`.
- Бакет закрыт для анонимного S3 GET. Клиент получает относительный
  `/api/v2/media/{uuid}`, а не storage URL. Доступ к API требует cookie-сессию
  и ACL, в том числе при условном запросе.
- `Cache-Control: private, no-cache`, `Vary: Origin, Authorization, Cookie`.
  API сейчас не публикует storage ETag/Last-Modified и не возвращает 304:
  условный GET проверяет доступ и заново выдаёт 200, либо 401/403.
- Credentialed CORS разрешён только для явно перечисленного `ALLOWED_ORIGINS`.
  Автоматически проверяются preflight GET/HEAD с Range/If-Range,
  `Access-Control-Allow-Credentials: true` и доступность JavaScript-заголовков
  `Content-Disposition`, `Content-Range`, `Accept-Ranges`.
  Чужой Origin не получает разрешающих CORS-заголовков; wildcard не даёт
  credentials (отдельный регрессионный тест edge).
- Имена UTF-8 сохраняются в upload/encrypted metadata. Проверяются ключи с
  кириллицей, пробелом, `#`, `?`, `+` и `%` в расширении: upload, proxy GET,
  подписанный S3 GET и DELETE. Исправлено URI-кодирование пути и SigV4-подписи.
  Обычный GET не добавляет `filename` в Content-Disposition: клиент использует
  имя из метаданных при сохранении Blob; имя не вставляется сырым в HTTP headers.
- Настоящий AES-GCM round-trip проверяет расшифровку, версию, эпоху ключа,
  plaintext size и имя. Range для encrypted envelope игнорируется: ответ
  всегда 200 с полным JSON; HEAD сообщает размер этого же JSON.
- Полный прогон сохраняет plain multipart ровно 100 МиБ в MinIO и читает
  его конец через GET/HEAD Range. Encrypted файл ровно 100 МиБ plaintext
  (+16 байт GCM tag) загружается, скачивается и расшифровывается;
  100 МиБ + 1 байт plaintext отклоняется с 413 `file_too_large`.

## Опубликованная политика клиента

`backend-v2/contracts/openapi/media-policy.json` опубликован edge по
`GET /docs/media-policy.json` и используется клиентом для лимита вложений.
Go-тест сверяет список MIME с реальным `allowedTypes`, overhead с GCM tag
и voice limit. Клиентские contract tests проверяют тот же артефакт.

По умолчанию: 104857600 байт файла, +16 байт для ciphertext, отдельный
предел voice ciphertext 8388608 байт. Plain MIME перечислены в JSON;
encrypted message files могут иметь любой MIME, включая документы и архивы.
Поэтому фильтр выбора вложений не ограничивается plain allowlist.

Для размещённого приложения `MAX_FILE_SIZE` должен соответствовать этому
контракту, а все внешние прокси — пропускать не меньше 140 МиБ JSON body.
Локальный прогон проверяет production-like storage и HTTP edge/media;
лимиты, TLS и cookies конкретного Amvera/Railway ingress проверяются после
деплоя по [инструкции](deployment.md#media-upload-limits-897).
