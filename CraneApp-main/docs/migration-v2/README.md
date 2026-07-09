# Backend v2 Migration

`backend-v2` is the replacement backend. It is intentionally isolated from the
legacy Node gateway until the single production cutover.

## Implemented vertical slice

- `edge`: public `/api/v2` routing and common HTTP response policy.
- `auth`: registration and login with ownership of the `auth` PostgreSQL schema.
- `user`: profile, user search, settings, privacy, and blocked users.
- `chat`: private/group chats, members, per-user pin/archive/read state.
- `crypto-rust`: Argon2id password hashing, signed short-lived access tokens,
  AES-256-GCM envelope encryption, and transition MLS artifact validation.
- OpenAPI v2 and Protobuf contract sources.
- Docker Compose and Kubernetes foundation.

The current internal crypto transport is HTTP and is isolated by Kubernetes
NetworkPolicy. Replace it with generated gRPC stubs and mTLS before production;
`contracts/proto/crypto.proto` is the source contract for that step.

## Local start

1. Start PostgreSQL, NATS, Redis, MinIO, crypto, auth, and edge:
   `docker compose -f infrastructure/docker/docker-compose.v2.yml up --build`.
2. Apply all SQL files in `backend-v2/migrations` to PostgreSQL.
3. Use the public API at `http://localhost:8080/api/v2`.

Before a cutover, run `make migrate-legacy-dry-run` from `backend-v2`. The
command uses a serializable transaction, verifies row counts, and always rolls
back unless `--apply` is explicitly passed.

## Required migration order

1. Add message, realtime, call, media, and support/admin services.
2. Add transactional outbox and NATS JetStream event consumers.
3. Implement the legacy-to-v2 migration tool while preserving UUIDs.
4. Generate the React API client from `contracts/openapi/api-v2.yaml`.
5. Run full migration rehearsals and load tests before enabling maintenance mode.

The Node backend remains the production source of truth until every client-used
feature has an API v2 implementation and the cutover checklist passes.
