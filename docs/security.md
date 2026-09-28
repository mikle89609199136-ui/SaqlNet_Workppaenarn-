# Security Considerations

- Never commit real secrets; `.env` is gitignored, `.env.example` holds
  placeholders only. Crypto secrets must be ≥32 random chars.
- The legacy gateway enforces Helmet with a strict Content Security Policy,
  CORS restricted to `ALLOWED_ORIGINS`, JWT verification with revocation
  checks, rate limiting, and anti-DDoS middleware — keep these intact when
  editing `server/gateway/apiGateway.js` or `server/middleware/security.js`.
- Server-side cryptography belongs to the Rust crypto service
  (`server/crypto-rust`, port 5005); Go/Node services call it over HTTP. Per
  `docs/migration-v2/README.md`, this transport is meant to become gRPC + mTLS
  before production — do not weaken the isolation (Kubernetes NetworkPolicy)
  in the meantime.
- Passwords: Argon2id via the crypto service (v2) / bcrypt (legacy). 2FA and
  session revocation logic live in `backend-v2/internal/auth`.
- Media uploads are validated against `ALLOWED_FILE_TYPES` and
  `MAX_FILE_SIZE`; keep validation server-side.
