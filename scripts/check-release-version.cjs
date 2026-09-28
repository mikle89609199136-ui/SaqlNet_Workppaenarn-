#!/usr/bin/env node
/*
 * Выпуск повышает номер версии (#892): `node scripts/check-release-version.cjs <base>`,
 * где base — прежний master (ветка или коммит).
 *
 * Номер — в frontend/package.json; корневой package.json должен совпадать.
 * Если у прежнего номера нет тега vX.Y.Z — это нумерация до #892 (в master
 * стояло 1.0.0 без смысла), сравнивать не с чем: проверка пропускается.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const base = process.argv[2];
if (!base) {
  console.error('Использование: node scripts/check-release-version.cjs <base>');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const versionOf = (json) => JSON.parse(json).version;

const head = versionOf(readFileSync(path.join(root, 'frontend/package.json'), 'utf8'));
const rootVersion = versionOf(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (rootVersion !== head) {
  console.error(`package.json (${rootVersion}) и frontend/package.json (${head}) расходятся.`);
  console.error('Номер меняется командой: npm run release:version -- minor|patch');
  process.exit(1);
}

const previous = versionOf(git('show', `${base}:frontend/package.json`));
const tagged = (() => {
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/v${previous}`);
    return true;
  } catch {
    return false;
  }
})();
if (!tagged) {
  console.log(`У ${previous} нет тега v${previous} — нумерация до #892, сравнение пропущено.`);
  process.exit(0);
}

const parse = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Не номер версии X.Y.Z: ${version}`);
  return match.slice(1).map(Number);
};
const [a, b] = [parse(head), parse(previous)];
const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
if (!newer) {
  console.error(`Версия не повышена: была ${previous}, стала ${head}.`);
  console.error('Выпуск dev → master: npm run release:version -- minor; хотфикс: -- patch.');
  process.exit(1);
}
console.log(`Версия выпуска: ${previous} → ${head}`);
