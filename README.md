# CraneApp

[![Go Tests](https://github.com/mikle89609199136-ui/CraneApp/actions/workflows/go-tests.yml/badge.svg)](https://github.com/mikle89609199136-ui/CraneApp/actions/workflows/go-tests.yml)

CraneApp is a secure messenger project with chats, groups, media sharing,
WebSocket realtime updates, WebRTC calls, and an official support bot.

The active backend is the Go service stack under `backend-v2`, with the Rust
crypto service under `server/crypto-rust`. The former Node.js gateway has been
removed. `backend-v2/cmd/migrate-legacy` remains available for importing old
database rows and uploaded files.

## Current Stack

- Frontend: React/Vite SPA in `client/mobile/react`.
- Backend: Go edge/auth/user/chat/media/admin services, PostgreSQL schemas,
  OpenAPI, Protobuf, NATS, Redis, and S3-compatible object storage.
- Crypto: Rust service with Argon2id password hashing, signed access tokens,
  AES-256-GCM envelope encryption, and MLS artifact validation.
- Infrastructure: Docker Compose and Kubernetes manifests.

## Repository Map

- `client/mobile/react` - React client.
- `dist` - generated React build output served by the Go edge.
- `server/crypto-rust` - Rust crypto service.
- `backend-v2` - new Go backend foundation.
- `database` - legacy database bootstrap and schema helpers.
- `infrastructure/docker/docker-compose.v2.yml` - local backend v2 stack.
- `infrastructure/kubernetes/v2` - Kubernetes foundation for backend v2.
- `docs/migration-v2` - backend migration notes.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Useful checks:

```bash
npm test
npm run test:react
```

`npm test` currently runs the architecture/syntax guard. 
React tests run through
Vitest.

## Mobile Web

The dedicated mobile web shell is served at:

```text
/mobile
```

Use this URL for phone-browser QA and future APK/EXE WebView wrappers. The
desktop SPA remains on `/` and `/chats`.

## Backend v2 Development

Run Go tests:

```bash
cd backend-v2
GOCACHE=/tmp/crane-go-cache go test ./...
```

Run Rust tests:

```bash
cd server/crypto-rust
cargo test
```

Build backend v2 containers:

```bash
docker compose -f infrastructure/docker/docker-compose.v2.yml build crypto auth edge
```

Start the local backend v2 stack:

```bash
docker compose -f infrastructure/docker/docker-compose.v2.yml up --build
```

The v2 public API is exposed through the edge gateway at:

```text
http://localhost:8080/api/v2
```

## Required Environment

Start from `.env.example` and set production-safe values before deployment:

- `DATABASE_URL`
- `CRYPTO_SIGNING_SECRET`
- `CRYPTO_ENCRYPTION_SECRET`
- `ALLOWED_ORIGINS`

Crypto secrets must be at least 32 random characters. Do not commit real
secrets.

## Backend v2

- Go `edge` gateway.
- Go `auth` service.
- Go `user` service for profiles, settings, search, and blocked users.
- Go `chat` service for private/group chats, members, and per-user chat state.
- Auth PostgreSQL schema and domain foundation schemas.
- Legacy data and upload migration dry-run/apply tool.
- OpenAPI v2 and Protobuf contracts.
- Rust crypto service without fixed mock crypto responses.
- Docker Compose and Kubernetes foundation.

See `docs/migration-v2/README.md` for the migration checklist.
