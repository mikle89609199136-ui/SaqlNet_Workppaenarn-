#!/usr/bin/env node
/*
 * Хук pre-push (lefthook): пуш в master — выпуск, и номер версии в нём
 * должен быть поднят на нужную величину (#892). Проверку делает
 * scripts/check-release-version.cjs — та же, что в CI; здесь она просто
 * срабатывает до деплоя, а не после.
 *
 * Git передаёт на stdin строки «<local ref> <local sha> <remote ref> <remote sha>».
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ZERO = /^0+$/;
const input = require('node:fs').readFileSync(0, 'utf8');
let failed = false;

for (const line of input.split('\n')) {
  const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
  if (remoteRef !== 'refs/heads/master' || !localSha || ZERO.test(localSha)) continue;
  // Новой ветки master на удалённом нет — сравнивать не с чем.
  if (!remoteSha || ZERO.test(remoteSha)) continue;
  try {
    execFileSync('node', [path.join(__dirname, 'check-release-version.cjs'), remoteSha, localSha], {
      stdio: 'inherit',
    });
  } catch {
    failed = true;
  }
}

if (failed) {
  console.error('\nПуш в master остановлен: поднимите номер версии (см. выше).');
  process.exit(1);
}
