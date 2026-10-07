# Deployment

- Production image: `Dockerfile.prod` — multi-stage build (Vite frontend → Go
  services → `crypto-rust` → NATS/MinIO binaries) into a single
  `debian:bookworm-slim` container supervised by `supervisord.conf`;
  the final image also runs a local Redis instance for ephemeral presence data;
  `REDIS_URL` may point the chat service at an external Redis instead;
  `docker-entrypoint.sh` runs migrations and, on first start, the full
  legacy→v2 data migration (marker file `/data/.legacy-v2-migration-complete`;
  disable with `RUN_LEGACY_MIGRATION=false`).
- Hosting platform: Amvera (`amvera.yaml` at root builds `Dockerfile.prod`,
  container port 8080, persistence mounted at `/data`; per-service manifests
  in `deploy/amvera/`). `railway.json` also exists for Railway.
- Production environment must define a positive `MAX_FILE_SIZE` in bytes for
  the media service (`.env.example` uses `104857600`, or 100 MiB).
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
`migrate-and-verify.sh`, `seedDatabase.js`.

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
