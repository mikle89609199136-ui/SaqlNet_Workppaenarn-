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

## Active WebSocket revocation (#409)

Auth publishes `auth_token_revoked` through PostgreSQL `NOTIFY` in the same
transaction as logout. Each Chat replica listens on that channel and closes
connections matching the token fingerprint, or older token generations for
logout-all. A delayed logout-all notification does not close a new login.
No schema migration or additional broker is required.

Chat rechecks authorization after connection registration and before processing
each incoming event. Heartbeat also checks every 30 seconds, so idle connections
are closed even if a notification was missed. Revocation checks have a 3-second
timeout and close the connection on database errors. This adds a database query
per incoming event and per heartbeat; an unavailable authorization database
therefore disconnects active sockets. Expired tokens are also rejected.

Integration coverage uses real PostgreSQL and two Chat replicas, with heartbeat
disabled for the test to verify notification-driven closure. Run from
`backend-v2`:

```sh
go test -race ./internal/chat ./internal/auth ./internal/platform/authctx
go test -race -tags=integration ./internal/chat -run '^TestActiveWSLogoutAcrossReplicas$' -count=1
```
