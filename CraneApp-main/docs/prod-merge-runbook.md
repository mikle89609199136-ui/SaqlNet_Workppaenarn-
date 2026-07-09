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
npm test
npm run test:react
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

## Rollback

Preferred rollback is redeploying the tagged previous version.

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
