# Configuration and Environment

Start from `.env.example` (it holds placeholders only; `.env` is gitignored —
never commit real secrets).

Key variables:

- `DATABASE_URL`, `REDIS_URL` — PostgreSQL and Redis connections.
- `JWT_SECRET` — legacy backend token signing (required).
- `CRYPTO_SIGNING_SECRET`, `CRYPTO_ENCRYPTION_SECRET` — Rust crypto service;
  each must be at least 32 random characters.
- `ALLOWED_ORIGINS` — CORS allowlist (comma-separated).
- `PORT`, `BCRYPT_ROUNDS`, `RATE_LIMIT_*` — server tuning.
- `MEDIA_UPLOAD_PATH`, `MAX_FILE_SIZE`, `ALLOWED_FILE_TYPES` — media uploads.
- `ADMIN_PASSWORD` — seeding.
- `METERED_API_KEY` / `METERED_DOMAIN` — WebRTC TURN.
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MEDIA_BUCKET` —
  MinIO (S3-compatible media storage).
- `RUN_LEGACY_MIGRATION=false` — disables the automatic legacy→v2 data
  migration on container first start (see `docs/deployment.md`).
- `AUTH_LOGOUT_ALL_GENERATION_ENABLED=false` — safety gate for generation-based
  logout-all. Keep it disabled through the compatibility rollout and enable it
  only after every crypto, issuer, and validator replica has been updated; see
  `docs/deployment.md`.
