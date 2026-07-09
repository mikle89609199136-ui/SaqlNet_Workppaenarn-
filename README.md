# CraneApp

CraneApp is a secure messenger project with chats, groups, media sharing,
WebSocket realtime updates, WebRTC calls, and an official support bot.

The repository currently contains two backend generations:

- **Legacy backend**: Node.js/Express gateway under `server/gateway`.
- **Backend v2 foundation**: Go services under `backend-v2` plus Rust crypto
  service under `server/crypto-rust`.

The legacy backend remains the main feature-complete implementation. Backend v2
is the migration path toward Go microservices with Rust-owned server
cryptography.

## Current Stack

- Frontend: React/Vite SPA in `client/mobile/react`.
- Legacy backend: Node.js, Express, `ws`, PostgreSQL.
- Backend v2: Go edge/auth services, PostgreSQL schemas, OpenAPI, Protobuf.
- Crypto: Rust service with Argon2id password hashing, signed access tokens,
  AES-256-GCM envelope encryption, and MLS artifact validation.
- Infrastructure: Docker Compose and Kubernetes manifests.

## Repository Map

- `client/mobile/react` - React client.
- `dist` - generated React build output served by the Go edge and legacy gateway.
- `server/gateway` - legacy Node API gateway and WebSocket server.
- `server/crypto-rust` - Rust crypto service.
- `backend-v2` - new Go backend foundation.
- `database` - legacy database bootstrap and schema helpers.
- `infrastructure/docker/docker-compose.v2.yml` - local backend v2 stack.
- `infrastructure/kubernetes/v2` - Kubernetes foundation for backend v2.
- `docs/migration-v2` - backend migration notes.

## Legacy Development

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

`npm test` currently runs the architecture/syntax guard. React tests run through
Vitest.

## Mobile Web

The dedicated mobile web shell is served at:

```text
/mobile
```

Use this URL for phone-browser QA and future APK/EXE WebView wrappers. The
desktop SPA remains on `/` and `/chats`.

## Backend v2 Development

Backend v2 is intentionally isolated from the legacy Node gateway until the full
cutover is ready.

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
- `JWT_SECRET` for the legacy backend
- `CRYPTO_SIGNING_SECRET`
- `CRYPTO_ENCRYPTION_SECRET`
- `ALLOWED_ORIGINS`

Crypto secrets must be at least 32 random characters. Do not commit real
secrets.

## Backend v2 Migration Status

Implemented:

- Go `edge` gateway.
- Go `auth` service.
- Go `user` service for profiles, settings, search, and blocked users.
- Go `chat` service for private/group chats, members, and per-user chat state.
- Auth PostgreSQL schema and domain foundation schemas.
- Legacy auth migration dry-run/apply tool.
- OpenAPI v2 and Protobuf contracts.
- Rust crypto service without fixed mock crypto responses.
- Docker Compose and Kubernetes foundation.

Still to migrate:

- messages/reactions/pins/forwarding
- realtime presence and WebSocket delivery
- calls and WebRTC signaling
- media storage with S3-compatible backend
- support/admin/bot flows
- React client switch to generated API v2 client

See `docs/migration-v2/README.md` for the migration checklist.
