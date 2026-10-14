# Vercel Blob: приватный адаптер media-service

## Исследование до реализации

До изменений `cmd/media` создавал `MinioStore`, проверял/создавал S3 bucket и
выполнял backfill storage identity старых стикеров. Уже существует интерфейс
`Store`: Put, Get с HEAD/Range, Delete, PresignGet. Его используют обычные и
зашифрованные загрузки, изображения стикеров/паков, download proxy и cleanup.
MinIO подписывает HTTP-запросы AWS SigV4; multipart относится к входному HTTP
form-data, storage multipart в приложении не используется.

Frontend получает `url: /api/v2/media/{id}` с прежними полями fileName,
sizeBytes, contentType и success. Стикеры/паки также возвращают эти маршруты.
Provider URL из PresignGet нужен как внутренняя ссылка/SQL-значение, не как
способ выдачи файла браузеру. GET/HEAD идут через существующую авторизацию и
proxy; Content-Type, Content-Length, Range/Content-Range и private Cache-Control
устанавливает текущая бизнес-логика. Не добавлены публичные обходные маршруты.

План реализации: переиспользовать Store, добавить приватный Blob HTTP-адаптер,
выбор конфигурации, условные startup-проверки и тесты. Frontend, SQL-схема,
MinIO, существующие handler-маршруты и их политики доступа не меняются.

## Реализация

Vercel не публикует Go SDK на странице Blob SDK (там TypeScript/Python).
Адаптер использует net/http и протокол официального SDK, API version 13:

- upload: PUT https://vercel.com/api/blob/?pathname=...;
- private download/HEAD: https://STORE.private.blob.vercel-storage.com/PATH
  с Bearer-токеном, Range передаётся без изменения;
- delete: POST https://vercel.com/api/blob/delete с JSON {"urls":["PATH"]}.

Путь — MEDIA_BUCKET/objectKey: bucket остаётся namespace, не S3 bucket.
Токен определяет Blob store. x-vercel-blob-access всегда private;
addRandomSuffix и allowOverwrite выключены. Существующие ключи user/time
сохраняются, traversal и некорректные пути отклоняются до сетевого запроса.
Ответ upload проверяется на совпадение pathname и PRIVATE URL. Public store
не поддерживается: private-запрос не должен превращаться в public upload.
Создание и смена store выполняются в панели Vercel, не приложением.

PresignGet в Blob возвращает лишь приватную storage-ссылку, без токена и без
гранта доступа; TTL не применяется. Это не S3 presigned URL. Существующие
handlers по-прежнему возвращают авторизованный proxy URL по ID. Прямая
приватная ссылка без Bearer-токена не должна открываться. Если другой
потребитель Store ожидает скачиваемый signed URL, такая операция не поддержана.

Адаптер не буферизует весь upload; использует Reader и известный размер.
Put ограничен MAX_FILE_SIZE и 2 минутами, Delete — 30 секундами; при Get
таймаут ожидания response headers — 30 сек., чтение потока следует context
HTTP-запроса. Redirect выключен, чтобы токен не отправлялся стороннему host.
Повторных запросов нет; ошибки содержат только категорию/HTTP-статус, без
response body, URL, токена и credentials. Delete 404 идемпотентен. Get
сохраняет статусы, включая 404/416/429, для прежней HTTP-семантики handler.

MinIO initialization и backfill запускаются только для MinIO. Cleanup остаётся
существующим; новый фоновый процесс не добавляется.

## Настройка

1. Vercel Project → Storage → Create Storage → Blob.
2. Выбрать **Private**. Public store не подходит для приватных медиа.
3. Подключить store к нужным окружениям, получить read-write token.
4. В Environment Variables выбранного проекта/окружения установить:

```env
STORAGE_PROVIDER=vercel_blob
BLOB_READ_WRITE_TOKEN=<секретный read-write token>
MEDIA_BUCKET=crane-media
MAX_FILE_SIZE=3145728
```

Токен сохранить как Sensitive. Не использовать VITE_* и не коммитить .env.
Данный адаптер использует static token, не OIDC, поскольку реализован на Go
без SDK-автообновления OIDC. Значение MAX_FILE_SIZE здесь — консервативный
пример для небольших файлов, а не обход платформенного ограничения.
MINIO_* для Blob не требуются. DATABASE_URL, REDIS_URL, NATS_URL, crypto
secrets и ALLOWED_ORIGINS по-прежнему нужны остальным компонентам.

Отсутствующий STORAGE_PROVIDER означает minio. Для возврата:

```env
STORAGE_PROVIDER=minio
MINIO_ENDPOINT=https://YOUR-S3-ENDPOINT
MINIO_ACCESS_KEY=<секрет>
MINIO_SECRET_KEY=<секрет>
MINIO_REGION=us-east-1
MEDIA_BUCKET=crane-media
```

Переключение provider не переносит объекты! Не подключать старую базу MinIO к
пустому Blob и не ожидать доступа к старым файлам. Сначала перенести каждый
объект в тот же namespace/key и проверить SQL-идентичности или использовать
отдельную тестовую базу. Поддержка чтения сразу из двух providers не добавлена;
возврат на MinIO после новых Blob uploads также требует переноса объектов.

## Лимиты и совместимость Vercel

Проверено по официальной документации 14 октября 2026:
Hobby включает 1 GB хранения (monthly average), 10 GB Blob transfer,
10 000 Simple Operations и 2 000 Advanced Operations. При превышении лимитов
Blob может быть недоступен до обновления квоты. Private download через backend
потребляет также ресурс передачи Function → browser. Смотрите актуальные
лимиты в панели; адаптер не обещает неограниченное бесплатное хранилище.

Vercel Functions документирует payload limit 4.5 MB. Наш API получает файлы
через функцию; JSON/base64 добавляет примерно 1/3 к размеру, multipart — свои
headers. Большой файл может получить 413 ещё ДО запуска Go-кода. Входной
multipart и шифрованные JSON в существующем сервисе уже буферизуют данные
(или временно используют /tmp); адаптер не добавляет копию в память и не
полагается на постоянный диск. Старый MAX_FILE_SIZE=100 MiB не является
гарантией поддержки таких uploads на Vercel.

Для больших uploads нужны согласованные изменения frontend/API для прямой
загрузки в Blob либо другой backend-хостинг, принимающий текущий контракт.
Они не сделаны в этой задаче. Streaming download и Range поддерживаются,
но реальное поведение body/duration ограничений container runtime нужно
проверить на preview. Текущий деплой показывал max duration 300 секунд.

Протокол HTTP взят из официальных исходников SDK, а не из S3-совместимости.
Его стабильность для сторонних клиентов не обещана: при обновлениях Vercel
проверять API version и заголовки. Реальные HTTP API/auth и совместимость
токена/PRIVATE store без реального store не подтверждены.

## Проверка preview

После установки env и миграций открыть frontend, войти, загрузить небольшой
разрешённый файл (<1 MB), скачать по /api/v2/media/{id}, проверить HEAD/Range,
стикер/иконку пака и удаление по существующим UI-операциям. Проверить без
авторизации и чужим аккаунтом существующие политики доступа; прямой private
Blob URL должен оставаться закрытым. Проверить 413 на слишком большом файле.
Токен не должен появиться в ответах, DevTools или logs. Для cleanup проверить
удаление связанного объекта после обработки очереди.

## Источники

- https://vercel.com/docs/vercel-blob/using-blob-sdk
- https://vercel.com/docs/vercel-blob/private-storage
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://vercel.com/docs/functions/limitations
- https://github.com/vercel/storage/tree/main/packages/blob/src

## Результаты локальной проверки

- `go test ./...` — прошёл; внешние integration-сценарии, требующие
  подключений/тегов, не подтверждены этим прогоном.
- `go test -race ./internal/media` — прошёл.
- `go build ./cmd/...` — прошёл.
- `docker build -f Dockerfile.vercel -t craneapp-vercel:blob-check .` — прошёл.
- Unit-тесты с подменённым HTTP-транспортом проверяют streaming upload,
  HEAD/Range, удаление/404, 401/403/404/409/413/429/500, отмену context,
  лимит размера, unsafe keys, запрет public/mismatched response, redirect,
  отсутствие утечек и выбор конфигурации. Existing MinIO tests проходят.
- Handler-тесты с Blob проверяют прежний 201/upload JSON и download статусы,
  тело, Content-Type и private Cache-Control.
- Диагностика env проверена на отсутствие MINIO_* требований для Blob
  и сокрытие BLOB_READ_WRITE_TOKEN; shell syntax проверен.
- Существующее пользовательское изменение `internal/chat/outbox.go`
  сохранено побайтно (SHA-256 до/после совпадает).

Реальный Blob Store не подключён. Upload/download/delete с настоящим токеном
не выполнялись. Реализация готова к контролируемой preview-проверке малых
файлов после подключения PRIVATE store; не считается проверенной production
интеграцией. Коммит/push/деплой автоматически не выполнялись.

Изменённые файлы адаптера:
- backend-v2/internal/media/vercel_blob.go (новый);
- backend-v2/internal/media/storage_config.go (новый);
- backend-v2/internal/media/vercel_blob_test.go (новый);
- backend-v2/internal/media/service.go (документация Store);
- backend-v2/cmd/media/main.go (выбор provider, MinIO-only initialization);
- deploy/vercel/start.sh (условные переменные);
- scripts/check-deployment-env.cjs (условная диагностика);
- .env.example и deploy/vercel/.env.example;
- docs/vercel-deployment.ru.md и этот документ.
