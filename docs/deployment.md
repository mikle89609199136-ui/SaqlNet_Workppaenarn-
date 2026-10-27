# Deployment

- Production image: `Dockerfile.prod` — multi-stage build (Vite frontend → Go
  services → `crypto-rust` → NATS/MinIO binaries) into a single
  `debian:bookworm-slim` container supervised by `supervisord.conf`;
  the final image also runs a local Redis instance for ephemeral presence data;
  `REDIS_URL` may point the chat service at an external Redis instead;
  `docker-entrypoint.sh` runs migrations and, on first start, the full
  legacy→v2 data migration (marker file `/data/.legacy-v2-migration-complete`;
  disable with `RUN_LEGACY_MIGRATION=false`).
- Hosting platform: Amvera (`amvera.yml` at root builds `Dockerfile.prod`,
  container port 8080, persistence mounted at `/data`). `railway.json` also
  exists for Railway.
- `MAX_FILE_SIZE` defaults to `104857600` (100 MiB) in the combined-image
  entrypoint and both Compose variants. Supervisor forwards the exported value
  to media. Standalone media processes must receive a positive value explicitly.
- Health endpoint: `/api/v2/health`.
- Merge/rollback process: follow `docs/prod-merge-runbook.md` — create a
  rollback tag before merging to `main`, smoke-check with
  `scripts/smoke-test.sh` after deploy.

## Docker Compose variants

- `infrastructure/docker/docker-compose.v2.yml` — local v2 stack (Postgres 16,
  NATS, Redis, MinIO + services).
- Root `docker-compose.yml` — a **different** full-stack variant (includes the
  legacy gateway, edge on port 3000, Postgres 15).

## Calls: one chat process per environment (#713)

For MVP, run exactly **one chat process against each environment's database**.
The combined Amvera image runs one chat process under Supervisor. Do not run
multiple copies of that image against the same database or scale the standalone
chat service above one replica.

Postgres stores call rooms, participants, timestamps and outcomes; completed
history is available through `GET /api/v2/calls/history`. Live rooms, pending
invitations, held accept responses, reconnect timers and WebSocket connections
remain in the chat process's memory. Call signaling is delivered to local sockets.
Shared Postgres, Redis presence, NATS and sticky sessions do not coordinate
these call states between chat processes.

`infrastructure/kubernetes/v2/foundation.yaml` therefore sets chat to one replica
with the `Recreate` strategy. A normal Deployment update stops the old pod before
starting the new one; `replicas: 1` with the default rolling strategy could still
run two chat processes during an update. Do not attach an HPA to chat. When moving
from an existing multi-replica deployment, stop the old chat instances during a
maintenance window before starting the single-instance deployment.

Updates interrupt WebSocket connections and temporarily make chat unavailable.
After startup, `RecoverCallRooms` loads recent, unfinished answered calls from
Postgres and allows their participants to rejoin for two minutes. Unanswered
calls are closed immediately; unanswered or abandoned calls keep their final
status in history. During normal operation, a socket disconnect has a separate
25-second grace period (#940). The client also waits 25 seconds for recovery, so
a long rollout can end the client call even while server recovery is still open.
This is restart recovery, not a zero-downtime or multi-replica guarantee.

Before raising the replica count, implement shared live-room ownership/state,
cross-process signaling to participants' sockets, and coordinated invitation,
timeout and history finalization. This coordination is outside the MVP decision
for #713.

After deploying, check that only one chat instance is running, make a 1:1 call,
and verify both users' history and a third user's lack of access. Check a brief
socket disconnect followed by `call_join`, then restart chat during an answered
call and reconnect promptly. Confirm that history retains the original answer
time and has one call entry. Reproducible backend checks against a disposable
Postgres with all migrations:

```bash
cd backend-v2
go test -tags=integration ./internal/chat -run 'TestCall(History|RestoreAfterRestart|PeerLeftReason)OnRealSchema' -count=1
```

## Operational scripts

`scripts/` contains: `start.sh`, `smoke-test.sh`, `load-test.sh`,
`migrate-and-verify.sh`, `seedDatabase.js`.

## Media upload limits (#897)

The reproducible edge/media/PostgreSQL/MinIO suite, browser download headers
and published client policy are documented in [Media download contract](media-download-contract.md).

Use `MAX_FILE_SIZE=104857600` in the local `.env` and the hosting environment
to match the client's 100 MB limit (the UI uses binary megabytes). An explicit
older value, such as `52428800`, overrides the entrypoint/Compose default:
update it in Amvera/Railway environment settings and restart the deployment.
Supervisor inherits this value; it does not impose a separate 50 MB limit.

Encrypted message uploads append a 16-byte AES-GCM tag, then encode the result
in Base64 inside JSON. Media allows `MAX_FILE_SIZE + 16` ciphertext bytes and
`4 * ceil((MAX_FILE_SIZE + 16) / 3) + 65536` JSON request bytes. With the
default, the JSON limit is 139875692 bytes, about 133.4 MiB. Plain uploads
retain the original 100 MiB limit. Checks use actual data sizes, independent
of the client-provided `sizeBytes`. Voice messages retain their separate
8 MiB ciphertext limit.

Every reverse proxy in front of edge must allow at least **140 MiB** per
request with this default. For a self-managed Nginx server, set this in the
existing API `server` or `location` configuration and reload Nginx:

```nginx
client_max_body_size 140m;
```

For ingress-nginx, the optional
`infrastructure/kubernetes/v2/ingress.yaml` sets
`nginx.ingress.kubernetes.io/proxy-body-size: "140m"` and routes to edge.
Adapt its host, ingress class and TLS configuration to the target cluster,
or copy the annotation onto the Ingress that already serves edge.

Amvera/Railway managed ingress and any additional CDN/proxy are configured
outside this repository. Arrange an equivalent body limit through the
platform's configuration/support before rollout; changing `MAX_FILE_SIZE`
inside the container cannot raise an upstream limit. If the upstream cannot
accept 140 MiB requests, use an ingress/plan that can before advertising
100 MiB uploads. Raise the proxy budget again if increasing `MAX_FILE_SIZE`.

Media returns oversized uploads as HTTP 413 with a flat JSON response:

```json
{"code":"file_too_large","message":"file exceeds 100 MB limit","requestId":"..."}
```

An upstream-generated 413 may use the proxy's own response format; it never
reaches media. Do not replace media's JSON errors with proxy error pages.

After deployment, send encrypted files of 1, 70, 80, 99.9 and exactly 100 MiB
through the public `POST /api/v2/media` endpoint and confirm HTTP 201. A file
of 104857601 original bytes must return the JSON 413 above. Check the public
route as well as the container port to detect an upstream rejection. The
backend regression test `TestEncryptedUpload100MiBBoundaries` exercises these
wire sizes with mocked database/storage; it does not verify hosted ingress.

## Kubernetes rollout for auth token generation

Migration `0025_auth_token_generation.sql` is an expand-only migration: it adds
the generation column with `0` as the value for existing users. The old
services can run against the expanded schema, but the generation-aware services
must not start against the old schema.

The v2 Kubernetes manifests enforce that boundary in two places:

- `migrate-0025-auth-token-generation.yaml` runs the repository's normal Go
  migration binary as a one-shot Job;
- the `auth`, `user`, and `chat` pods in `foundation.yaml` wait in an init
  container until both the migration record and the required column shape are
  present. A missing migration therefore keeps a new pod unready instead of
  serving `500`/`503` responses.

Build and publish `migrate`, `crypto`, and every Go service with one immutable
release tag or image digest. Replace `craneapp/migrate:v2` in the Job manifest
with that immutable reference before applying it. Do not reuse a mutable tag
for a migration Job.

### Phase 1: expand and deploy with activation disabled

Keep `AUTH_LOGOUT_ALL_GENERATION_ENABLED=false` on every `auth` replica during
this phase. The namespace `craneapp-v2` and its `database-secrets` Secret must
already exist before starting the migration Job.

1. Apply and wait for the schema Job:

   ```bash
   kubectl apply -f infrastructure/kubernetes/v2/migrate-0025-auth-token-generation.yaml
   kubectl wait --namespace craneapp-v2 \
     --for=condition=complete job/migrate-0025-auth-token-generation \
     --timeout=10m
   kubectl logs --namespace craneapp-v2 job/migrate-0025-auth-token-generation
   ```

2. Confirm that the migration finished with the expected schema. Run this
   query through the production database administration path:

   ```sql
   SELECT version
   FROM public.schema_migrations
   WHERE version = '0025_auth_token_generation.sql';

   SELECT data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_schema = 'auth'
     AND table_name = 'users'
     AND column_name = 'token_generation';
   ```

   The first query must return one row. The second must report `bigint`, `NO`,
   and a zero default. Before first activation, also verify that this query
   returns `0`:

   ```sql
   SELECT COUNT(*) FROM auth.users WHERE token_generation <> 0;
   ```

   A non-zero result means generation revocation was already activated; use the
   post-activation rules below and do not mix old and new crypto replicas.

3. Roll out the generation-aware `crypto` image and wait until both replicas
   run that exact immutable image:

   ```bash
   kubectl set image --namespace craneapp-v2 deployment/crypto \
     crypto=craneapp/crypto:<release-tag>
   kubectl rollout status --namespace craneapp-v2 deployment/crypto --timeout=10m
   ```

4. Roll out every service that verifies tokens (`user`, `chat`, `media`,
   `admin`, and `auth`) and wait for each rollout. `media` and `admin` are not
   currently declared in `foundation.yaml`, but they are still mandatory when
   present in the target cluster. Keep the auth activation flag false while
   updating `auth`:

   ```bash
   RELEASE_TAG=<immutable-release-tag>
   kubectl set env --namespace craneapp-v2 deployment/auth \
     AUTH_LOGOUT_ALL_GENERATION_ENABLED=false
   kubectl set image --namespace craneapp-v2 deployment/user \
     user=craneapp/user:$RELEASE_TAG
   kubectl set image --namespace craneapp-v2 deployment/chat \
     chat=craneapp/chat:$RELEASE_TAG
   kubectl set image --namespace craneapp-v2 deployment/auth \
     auth=craneapp/auth:$RELEASE_TAG
   kubectl rollout status --namespace craneapp-v2 deployment/user --timeout=10m
   kubectl rollout status --namespace craneapp-v2 deployment/chat --timeout=10m
   kubectl rollout status --namespace craneapp-v2 deployment/auth --timeout=10m
   ```

   Update `media` and `admin` with the same immutable release tag and wait for
   their new revisions when those deployments exist. Verify the running image
   IDs, not only a successful status of an earlier revision. Do not proceed
   while any old crypto, issuer, or verifier pod remains in service.

### Phase 2: activate generation revocation

Only after Phase 1 and its smoke checks have completed, enable the feature and
wait for both auth replicas. First persist `true` in the environment-specific
Kustomize/Helm/GitOps value that owns the auth Deployment; the checked-in
`foundation.yaml` intentionally remains a safe bootstrap manifest with
`false`. Then reconcile that desired state (or use the command below for a
non-GitOps cluster):

```bash
kubectl set env --namespace craneapp-v2 deployment/auth \
  AUTH_LOGOUT_ALL_GENERATION_ENABLED=true
kubectl rollout status --namespace craneapp-v2 deployment/auth --timeout=10m
```

Do not rely on the imperative command alone in a reconciled cluster: a later
apply of the bootstrap manifest would restore `false`. The environment's
durable desired state must remain `true` after activation.

Exercise the complete acceptance scenario: create two access tokens, call
`POST /api/v2/auth/logout-all` with one, confirm that both old tokens receive
`401` in auth and user APIs and on a new WebSocket handshake, then confirm that
a token from a new login succeeds.

### Rollback boundary

Before Phase 2, application images may be rolled back while leaving migration
0025 in place. Do not drop `auth.users.token_generation` and do not remove its
`schema_migrations` record; the expansion is backward-compatible.

After Phase 2, a rollback to any pre-generation crypto, token issuer, or token
verifier is forbidden while the current signing secret remains active. Such a
rollback can accept access tokens already revoked by `logout-all`, and mixed
old/new crypto replicas can issue or verify the wrong generation. Setting the
feature flag back to `false` stops new increments but does not make that
rollback safe.

If an emergency requires a pre-generation rollback after activation:

1. enter an authentication maintenance window and set the activation flag to
   `false`;
2. rotate the signing value actually used by the target deployment: `JWT_SECRET`
   for the Amvera/`Dockerfile.prod` combined image, or the
   `crypto-secrets/signing-secret` (`CRYPTO_SIGNING_SECRET`) value for the
   separate Kubernetes crypto service. Never rotate
   `CRYPTO_ENCRYPTION_SECRET` as part of this procedure;
3. replace all crypto replicas as one coordinated operation so old and new
   signing keys are never simultaneously serving traffic;
4. roll back all token issuers and verifiers as one coordinated release;
5. require every client to authenticate again.

Keep migration 0025 applied throughout. Signing-key rotation is a global logout
and is the security boundary that prevents previously revoked tokens from
becoming valid again on pre-generation code.

## Amvera / combined-image activation

The production `Dockerfile.prod` contains crypto and every Go service in one
image, but activation still uses two deployments so that a platform rollout
can never mix an active new issuer with an old validator:

1. Publish and deploy the new immutable image with
   `AUTH_LOGOUT_ALL_GENERATION_ENABLED=false`. The entrypoint applies migration
   0025 before Supervisor starts the services.
2. Wait for the deployment to finish, run the health/smoke checks, and verify
   that the running crypto `/health/ready` response advertises
   `capabilities.token_generation=true`.
3. Set `AUTH_LOGOUT_ALL_GENERATION_ENABLED=true` in Amvera and redeploy the
   **same image digest**. Then run the two-old-tokens/new-login acceptance
   scenario described above.

For compatibility with the existing production image, Supervisor passes
`JWT_SECRET` to the Rust process as its `CRYPTO_SIGNING_SECRET`. After feature
activation, rotate the actual `JWT_SECRET` value before any rollback to
pre-generation code. `CRYPTO_SIGNING_SECRET` is the direct variable only in the
separate crypto container used by Compose/Kubernetes.

## Docker Compose activation

Both Compose variants default the activation flag to `false`, because Compose
may replace service containers sequentially. With the flag absent from `.env`
(or explicitly set to `false`), first rebuild and start the full stack:

```bash
docker compose up -d --build
```

Wait for every readiness check and verify that no old crypto, issuer, or
validator container remains. Only then set
`AUTH_LOGOUT_ALL_GENERATION_ENABLED=true` in the local, gitignored `.env` file
so activation survives future `docker compose up` commands, and recreate only
auth:

```bash
docker compose up -d --no-deps --force-recreate auth
```

For the v2 Compose file, pass `-f infrastructure/docker/docker-compose.v2.yml`
to both commands. Repeat the acceptance scenario after activation.
