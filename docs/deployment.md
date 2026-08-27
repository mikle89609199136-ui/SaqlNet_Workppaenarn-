# Deployment

- Production image: `Dockerfile.prod` — multi-stage build (Vite frontend → Go
  services → `crypto-rust` → NATS/MinIO binaries) into a single
  `debian:bookworm-slim` container supervised by `supervisord.conf`;
  `docker-entrypoint.sh` runs migrations and, on first start, the full
  legacy→v2 data migration (marker file `/data/.legacy-v2-migration-complete`;
  disable with `RUN_LEGACY_MIGRATION=false`).
- Hosting platform: Amvera (`amvera.yaml` at root builds `Dockerfile.prod`,
  container port 8080, persistence mounted at `/data`; per-service manifests
  in `deploy/amvera/`). `railway.json` also exists for Railway.
- Health endpoint: `/api/v2/health`.
- Merge/rollback process: follow `docs/prod-merge-runbook.md` — create a
  rollback tag before merging to `main`, smoke-check with
  `scripts/smoke-test.sh` after deploy.

## Docker Compose variants

- `infrastructure/docker/docker-compose.v2.yml` — local v2 stack (Postgres 16,
  NATS, Redis, MinIO + services).
- Root `docker-compose.yml` — a **different** full-stack variant (includes the
  legacy gateway, edge on port 3000, Postgres 15).

## Operational scripts

`scripts/` contains: `start.sh`, `smoke-test.sh`, `load-test.sh`,
`migrate-and-verify.sh`, `seedDatabase.js`, `checkArchitecture.js`.
