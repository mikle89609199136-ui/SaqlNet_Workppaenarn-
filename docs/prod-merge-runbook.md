# Production merge and rollback runbook

Use this checklist before merging a local branch into GitHub `main`.

## Current baseline

- Local branch prepared from: `origin/main` at `64fce98`.
- Production health endpoint: `/api/v2/health`.
- Fast rollback target must be recorded before merge:

```bash
git fetch origin
git rev-parse --short origin/main
git tag rollback/main-before-merge-YYYYMMDD origin/main
git push origin rollback/main-before-merge-YYYYMMDD
```

## Pre-merge checks

Run these locally before pushing/merging:

```bash
cd frontend && npm ci && cd ..
npm test
npm run build:react
```

Also verify dependency lockfiles before enabling frozen installs:

```bash
npm ls bcrypt bcryptjs --depth=0
```

Do not switch production to `npm ci` or `pnpm --frozen-lockfile` until the active lockfile matches `package.json`.

## Merge

1. Confirm the worktree is clean: `git status --short`.
2. Confirm the branch contains current main: `git diff --stat origin/main...HEAD`.
3. Create and push the rollback tag from the current `origin/main`.
4. Merge via GitHub.
5. Wait for the platform deploy to finish.

## Post-deploy smoke check

Replace `BASE_URL` with the production URL:

```bash
BASE_URL=https://example.com
curl -fsS "$BASE_URL/api/v2/health"
./scripts/smoke-test.sh "$BASE_URL"
```

If either command fails, roll back immediately.

### Token-generation release (#406)

For the release that introduces migration 0025, the first Amvera deployment
must use `AUTH_LOGOUT_ALL_GENERATION_ENABLED=false`. After that exact image has
passed the smoke checks above:

1. confirm migration `0025_auth_token_generation.sql` is recorded and the auth
   service readiness check succeeds;
2. set `AUTH_LOGOUT_ALL_GENERATION_ENABLED=true` in Amvera;
3. redeploy the same image digest and repeat the smoke checks;
4. run the acceptance scenario from `docs/deployment.md`: two old tokens become
   `401` for HTTP and a new WebSocket handshake, while a subsequent login token
   succeeds.

Do not combine the compatibility deployment and activation into one rollout.

## Rollback

Preferred rollback is redeploying the tagged previous version.

Exception: once `AUTH_LOGOUT_ALL_GENERATION_ENABLED=true` has served production
traffic, do **not** redeploy a version from before token-generation support with
the existing `CRYPTO_SIGNING_SECRET`. Disabling the flag alone is insufficient:
the old version can accept tokens that `logout-all` already revoked. Follow the
post-activation procedure in `docs/deployment.md`, including a coordinated
signing-key rotation and forced reauthentication. In the combined production
image the Rust signer receives `JWT_SECRET`, so that is the value that must be
rotated; the separate Kubernetes crypto service uses
`crypto-secrets/signing-secret`. Keep migration 0025 applied; never drop
`auth.users.token_generation` during an application rollback.

For Railway/GitHub auto-deploy, revert `main` to the rollback tag with a new commit:

```bash
git fetch origin --tags
git switch main
git pull --ff-only origin main
git revert --no-edit rollback/main-before-merge-YYYYMMDD..HEAD
git push origin main
```

For Amvera git deploy, push the rollback tag directly to its deploy branch:

```bash
git fetch origin --tags
git push amvera rollback/main-before-merge-YYYYMMDD:main
```

After rollback, repeat:

```bash
curl -fsS "$BASE_URL/api/v2/health"
./scripts/smoke-test.sh "$BASE_URL"
```
