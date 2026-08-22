# Как запустить CraneApp

## Требования

- Node.js 18+
- Docker Desktop
- Git

Для разработки backend v2 без Docker также нужны Go и Rust/Cargo, но основной
локальный запуск ниже рассчитан на Docker Compose.

## Установка инструментов

1. Установите Git с [git-scm.com](https://git-scm.com/downloads).

2. Установите Node.js 20 LTS с [nodejs.org](https://nodejs.org/). Вместе с
   Node.js устанавливается npm. Node.js 18 остаётся минимально поддерживаемой
   версией, но в CI используется Node.js 20.

3. Установите Docker Desktop с
   [docs.docker.com](https://docs.docker.com/desktop/). Docker Compose входит в
   состав Docker Desktop.

4. Если планируете запускать и проверять backend без Docker, установите:

   - Go версии из `backend-v2/go.mod` с [go.dev](https://go.dev/dl/);
   - Rust через [rustup](https://rustup.rs/), затем toolchain, используемый в CI:

     ```bash
     rustup toolchain install 1.94.0 --profile minimal --component rustfmt,clippy
     rustup default 1.94.0
     ```

Проверьте установку:

```bash
git --version
node --version
npm --version
docker --version
docker compose version
```

Для разработки backend без Docker также выполните:

```bash
go version
rustc --version
cargo --version
```

## Шаги

1. Клонируйте репозиторий:

   ```bash
   git clone https://github.com/mikle89609199136-ui/CraneApp.git
   ```

2. Перейдите в директорию проекта:

   ```bash
   cd CraneApp
   ```

3. Установите зависимости:

   ```bash
   npm ci
   ```

4. Создайте локальный файл окружения:

   ```bash
   cp .env.example .env
   ```

5. Заполните `.env` значениями из `.env.example`.

   Для локального Docker Compose обычно достаточно проверить эти переменные:

   ```env
   JWT_SECRET=change-me-local-jwt-secret
   CRYPTO_SIGNING_SECRET=change-me-local-signing-secret-32chars
   CRYPTO_ENCRYPTION_SECRET=change-me-local-encryption-secret-32
   ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000,http://localhost:5173
   ```

   `CRYPTO_SIGNING_SECRET` и `CRYPTO_ENCRYPTION_SECRET` должны быть не короче
   32 символов.

6. Запустите бэкенд:

   ```bash
   docker compose --env-file .env -f infrastructure/docker/docker-compose.v2.yml up -d --build
   ```

7. Запустите фронтенд:

   ```bash
   npm exec vite -- --host 127.0.0.1 --port 3000
   ```

8. Откройте приложение:

   ```text
   http://localhost:3000
   ```

## Проверки

Установите frontend-зависимости из lock-файла:

```bash
npm ci
```

Запустите полный набор frontend-проверок из корня проекта:

```bash
npm run typecheck
npm test
npm run test:react
npm run build:react
```

- `typecheck` проверяет TypeScript без создания сборки;
- `test` запускает архитектурные и синтаксические ограничения;
- `test:react` запускает тесты Vitest;
- `build:react` проверяет production-сборку Vite.

Проверки Go backend v2:

```bash
(
  cd backend-v2
  test -z "$(gofmt -l .)"
  go vet ./...
  go test ./...
  go build ./...
)
```

Проверки Rust crypto-сервиса:

```bash
(
  cd server/crypto-rust
  cargo fmt --check
  cargo clippy --locked --all-targets -- -D warnings
  cargo test --locked
  cargo build --release --locked
)
```

Команды соответствуют основным проверкам GitHub Actions. Выполнять все группы
локально обязательно перед крупным pull request; при изолированном изменении
достаточно затронутой группы, а полный набор всё равно будет запущен в CI.

## Troubleshooting

### Docker daemon не запущен

Ошибка:

```text
failed to connect to the docker API
```

Решение: запустите Docker Desktop и повторите команду `docker compose`.

### Порт уже занят

Ошибка:

```text
bind: address already in use
```

Решение: остановите процесс на занятом порту или измените порт в compose/env.
Чаще всего используются `8080`, `5433`, `6380`, `5005`, `9000`, `9001`.

### Не заполнены crypto secrets

Ошибка:

```text
CRYPTO_SIGNING_SECRET is required
```

Решение: заполните `CRYPTO_SIGNING_SECRET` и `CRYPTO_ENCRYPTION_SECRET` в `.env`.
Оба значения должны быть не короче 32 символов.

### `npm install` падает из-за `.npmrc`

Ошибка:

```text
config prefix cannot be changed from project config
```

Решение: убедитесь, что в project `.npmrc` нет строки `prefix=...`. Такой prefix
нужно хранить в пользовательском npm config, а не в репозитории.

### Go cache недоступен

Ошибка:

```text
go: failed to trim cache
```

Решение: задайте cache-директорию внутри временной папки:

```bash
GOCACHE=/tmp/crane-go-cache go test ./...
```

### Frontend открылся, но API не отвечает

Проверьте, что Docker Compose stack поднялся без ошибок и gateway доступен:

```bash
curl -I http://localhost:8080
```

Если запущен только Vite dev server, frontend будет доступен, но API-запросы
будут падать без backend gateway.
