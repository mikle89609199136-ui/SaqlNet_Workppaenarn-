# Выпуск на прод и откат

Прод — Amvera. Пуш в `master` запускает `.github/workflows/deploy-amvera.yml`:
он отправляет `master` в Amvera, и та собирает образ по `Dockerfile.prod`.
Работа идёт в `dev`; выпуск — слияние `dev` → `master`.

## Версия (#892)

- Номер — `version` в `frontend/package.json`; корневой `package.json`
  повторяет его. Приложение показывает версию в «Настройки → О приложении»,
  сервер — в `/health/live`.
- Нумерация [SemVer](https://semver.org/lang/ru/), пока до 1.0: `0.MINOR.PATCH`.
- Какую часть поднять — по коммитам выпуска:
  `node scripts/release-bump.cjs origin/master origin/dev`. Есть `feat` —
  MINOR; только исправления и прочее — PATCH; ломающее изменение (`feat!:`,
  «BREAKING CHANGE») — MAJOR, но до 1.0 — MINOR. Номер поднимает
  `npm run release:version -- minor|patch`; хотфикс в `master` — обычно PATCH.
- Точка отсчёта — `0.9.0`: до #892 в `master` было девять выпусков из `dev`.
  Первый выпуск по этой схеме — `0.10.0`.
- Номер не поднят или поднят меньше, чем требуют коммиты, — пуш в `master`
  останавливает хук `pre-push` (lefthook, `scripts/pre-push-release.cjs`), а
  PR в `master` — CI (`Release version`). Обходить хук (`--no-verify`) нельзя.
- После пуша в `master` `.github/workflows/release-tag.yml` ставит тег
  `vX.Y.Z` и создаёт GitHub Release со списком вошедших PR. Руками тег не нужен.
- Открытые у людей приложения узнают о новой версии сами (при возврате в
  приложение, после переподключения к серверу, раз в полчаса) и показывают
  плашку «Новая версия» с кнопкой «Обновить».

## Перед выпуском

```bash
git fetch origin
git log --oneline origin/master..origin/dev   # что едет
git merge-tree --write-tree --name-only origin/master origin/dev   # конфликты
git diff --name-status origin/master origin/dev -- backend-v2/migrations
```

- CI на последнем коммите `dev` зелёный.
- Новые переменные окружения уже заданы в Amvera (`docs/configuration.md`).
- Новое во входных данных сборки есть в `Dockerfile.prod`; при сомнении —
  `docker build --target frontend -f Dockerfile.prod .` и `--target gobuilder`.

## Выпуск

1. Тег отката на текущем `master`:
   ```bash
   git tag rollback/master-before-merge-YYYYMMDD origin/master   # второй за день — …-YYYYMMDD-2
   git push origin rollback/master-before-merge-YYYYMMDD
   ```
2. Слияние и номер версии:
   ```bash
   git switch master && git pull --ff-only origin master
   git merge --no-ff origin/dev -m "release: dev → master (0.10.0: кратко, что едет)"
   npm run release:version -- minor
   git commit -am "chore(release): 0.10.0"
   git push origin master
   ```
3. Дождаться деплоя: `/health/live` отдаёт новую версию.
   ```bash
   curl -fsS https://craneapp-timkhazatsky.amvera.io/health/live
   # {"build":"…","status":"ok","version":"0.10.0"}
   ```
4. Проверить, что появились тег `v0.10.0` и Release, и влить `master`
   обратно в `dev` (PR «chore: sync master into dev», обычное слияние, не
   сквош): иначе номер версии в `dev` отстанет.

Хотфикс: ветка от `master`, в ней `npm run release:version -- patch`, PR в
`master`, после деплоя — синхронизация `master` → `dev`.

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

## Откат

Откат — это тоже выпуск: содержимое возвращается к тегу отката, а номер
версии идёт вперёд (иначе CI и открытые приложения сочтут его старым).

```bash
git fetch origin --tags
git switch master && git pull --ff-only origin master
git read-tree -u --reset rollback/master-before-merge-YYYYMMDD   # файлы — как до выпуска
npm run release:version -- 0.10.1   # был 0.10.0: следующий патч
git commit -am "revert: откат к rollback/master-before-merge-YYYYMMDD (0.10.1)"
git push origin master
```

Пуш в `master` снова запускает деплой и ставит тег `v0.10.1`.

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

После отката — снова `/health/live` и `./scripts/smoke-test.sh "$BASE_URL"`.
