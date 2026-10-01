#!/usr/bin/env node
/*
 * Выпуск в master поднимает номер версии — и на столько, сколько нужно (#892).
 *
 *   node scripts/check-release-version.cjs <base> [head]
 *
 * base — прежний master (ветка или коммит), head — то, что уходит в master
 * (по умолчанию HEAD). Запускают CI (`Release version`) и хук pre-push.
 *
 * - Номер — в frontend/package.json; корневой package.json должен совпадать.
 * - Прежний номер — последний тег выпуска vX.Y.Z, достижимый из base. Тега
 *   нет — нумерация до #892, сравнивать не с чем: проверка пропускается.
 * - Сколько поднять — по коммитам base..head (scripts/release-bump.cjs):
 *   есть `feat` — хотя бы minor, только исправления — хотя бы patch.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  LEVELS,
  bumpLevel,
  bumpVersion,
  releaseCommits,
  releasedVersion,
  suggestBump,
} = require('./release-bump.cjs');

const [base, head = 'HEAD'] = process.argv.slice(2);
if (!base) {
  console.error('Использование: node scripts/check-release-version.cjs <base> [head]');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const versionAt = (file) =>
  JSON.parse(execFileSync('git', ['show', `${head}:${file}`], { cwd: root, encoding: 'utf8' }))
    .version;

const next = versionAt('frontend/package.json');
const rootVersion = versionAt('package.json');
if (rootVersion !== next) {
  console.error(`package.json (${rootVersion}) и frontend/package.json (${next}) расходятся.`);
  console.error('Номер меняется командой: npm run release:version -- minor|patch');
  process.exit(1);
}

const previous = releasedVersion(base);
if (!previous) {
  console.log(`У ${base} нет тега выпуска vX.Y.Z — нумерация до #892, сравнение пропущено.`);
  process.exit(0);
}

const { level: required, reasons } = suggestBump(releaseCommits(base, head), previous);
const actual = bumpLevel(previous, next);

const explain = () => {
  if (!required) return;
  console.error(
    `Нужно: ${previous} → ${bumpVersion(previous, required)} (${required}), потому что:`
  );
  for (const reason of reasons.slice(0, 10)) console.error(`  • ${reason}`);
  console.error(`Команда: npm run release:version -- ${required}`);
};

if (!actual) {
  console.error(`Версия не поднята: выпущена ${previous}, в выпуске ${next}.`);
  explain();
  process.exit(1);
}
if (required && LEVELS.indexOf(actual) < LEVELS.indexOf(required)) {
  console.error(
    `Поднят ${actual} (${previous} → ${next}), а в выпуске есть изменения на ${required}.`
  );
  explain();
  process.exit(1);
}
console.log(`Версия выпуска: ${previous} → ${next} (${actual})`);
