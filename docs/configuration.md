# Configuration and Environment

Start from `.env.example` (it holds placeholders only; `.env` is gitignored —
never commit real secrets).

Key variables:

- `DATABASE_URL`, `REDIS_URL` — PostgreSQL and Redis connections.
- `JWT_SECRET` — legacy backend token signing (required).
- `CRYPTO_SIGNING_SECRET`, `CRYPTO_ENCRYPTION_SECRET` — Rust crypto service;
  each must be at least 32 random characters.
- `ALLOWED_ORIGINS` — CORS allowlist (comma-separated). The browser session
  lives in a cookie (#705): state-changing requests and WebSocket handshakes
  that carry it are accepted only from the site itself or an origin listed
  **exactly** here; `*` never allows credentials. Required in production —
  the combined image refuses to start without it; set it to the public address,
  e.g. `https://craneapp-timkhazatsky.amvera.io`.
- `CRANE_ENV` — `production` in the combined image (`docker-entrypoint.sh`
  sets it for every service). Production issues the session cookie as
  `__Host-craneapp_session` (Secure, host-only); elsewhere it is
  `craneapp_session` without Secure, so `http://localhost` works.
- `PORT`, `BCRYPT_ROUNDS`, `RATE_LIMIT_*` — server tuning.
- `MEDIA_UPLOAD_PATH`, `MAX_FILE_SIZE`, `ALLOWED_FILE_TYPES` — media uploads.
- `ADMIN_PASSWORD` — seeding.
- `METERED_API_KEY` / `METERED_DOMAIN` — WebRTC TURN.
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MEDIA_BUCKET` —
  MinIO (S3-compatible media storage).
- `RUN_LEGACY_MIGRATION=false` — disables the automatic legacy→v2 data
  migration on container first start (see `docs/deployment.md`).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push (#717),
  services `chat` (all three) and `user` (public key only). Unset — push
  notifications are disabled, everything else works. Generate a pair with
  `go run ./cmd/vapidkeys` (in `backend-v2`); the private key is a secret —
  platform secret storage only. `VAPID_SUBJECT` is a contact: an e-mail
  (`admin@example.com` or `mailto:admin@example.com` — both work, the server
  sends exactly one `mailto:`) or an `https://` URL. Changing the pair invalidates every existing
  subscription: devices must subscribe again.
- `AUTH_LOGOUT_ALL_GENERATION_ENABLED=false` — safety gate for generation-based
  logout-all. Keep it disabled through the compatibility rollout and enable it
  only after every crypto, issuer, and validator replica has been updated; see
  `docs/deployment.md`.
