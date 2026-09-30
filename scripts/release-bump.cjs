#!/usr/bin/env node
/*
 * Какую часть версии поднять в выпуске (#892) — по коммитам выпуска.
 *
 *   node scripts/release-bump.cjs <base> [head]
 *   например: node scripts/release-bump.cjs origin/master origin/dev
 *
 * Правила (заголовки коммитов — Conventional Commits, как в проекте):
 * - ломающее изменение (`feat!:`, `fix(x)!:`, «BREAKING CHANGE» в теле) —
 *   major; пока версия 0.x — minor: до 1.0 SemVer не обещает совместимости;
 * - `feat` — minor;
 * - всё остальное (`fix`, `perf`, `refactor`, `chore`, `docs`, `test`…) — patch;
 * - служебные коммиты выпуска (`release:`, `chore(release):`, синхронизация
 *   master ↔ dev) не считаются; кроме них ничего — выпускать нечего.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LEVELS = ['patch', 'minor', 'major'];
const SERVICE =
  /^(release\b|chore\(release\)|chore: sync (master|dev) into (master|dev)|merge: sync)/i;
const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:/;

/** Коммиты выпуска: { subject, body } без слияний. */
function releaseCommits(base, head, root = path.resolve(__dirname, '..')) {
  const raw = execFileSync(
    'git',
    ['log', '--no-merges', '--format=%s%x1f%b%x1e', `${base}..${head}`],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ''] = entry.split('\x1f');
      return { subject: subject.trim(), body };
    });
}

/**
 * Что поднять и почему. `currentVersion` — прежний выпуск: в 0.x ломающее
 * изменение поднимает minor, а не major.
 */
function suggestBump(commits, currentVersion) {
  const counted = commits.filter((commit) => !SERVICE.test(commit.subject));
  if (counted.length === 0) return { level: null, reasons: [], counted: 0 };

  const breaking = counted.filter(
    (commit) =>
      CONVENTIONAL.exec(commit.subject)?.[3] === '!' || /BREAKING[ -]CHANGE/.test(commit.body)
  );
  const features = counted.filter((commit) => CONVENTIONAL.exec(commit.subject)?.[1] === 'feat');
  const preOne = /^0\./.test(currentVersion);

  if (breaking.length > 0) {
    return {
      level: preOne ? 'minor' : 'major',
      reasons: breaking.map((commit) => `ломающее: ${commit.subject}`),
      counted: counted.length,
    };
  }
  if (features.length > 0) {
    return {
      level: 'minor',
      reasons: features.map((commit) => `новое: ${commit.subject}`),
      counted: counted.length,
    };
  }
  return {
    level: 'patch',
    reasons: [`только исправления и прочее: ${counted.length} коммит(ов)`],
    counted: counted.length,
  };
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Не номер версии X.Y.Z: ${version}`);
  return match.slice(1).map(Number);
}

function bumpVersion(version, level) {
  const [major, minor, patch] = parseVersion(version);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Какую часть подняли: 'major' | 'minor' | 'patch' | null (не выросла). */
function bumpLevel(previous, next) {
  const [a, b] = [parseVersion(next), parseVersion(previous)];
  if (a[0] !== b[0]) return a[0] > b[0] ? 'major' : null;
  if (a[1] !== b[1]) return a[1] > b[1] ? 'minor' : null;
  if (a[2] !== b[2]) return a[2] > b[2] ? 'patch' : null;
  return null;
}

/** Последний выпущенный номер: тег vX.Y.Z, достижимый из ref; нет — null. */
function releasedVersion(ref, root = path.resolve(__dirname, '..')) {
  try {
    const tag = execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ref],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();
    return /^v\d+\.\d+\.\d+$/.test(tag) ? tag.slice(1) : null;
  } catch {
    return null;
  }
}

module.exports = {
  LEVELS,
  releaseCommits,
  suggestBump,
  bumpVersion,
  bumpLevel,
  parseVersion,
  releasedVersion,
};

if (require.main === module) {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  if (!base) {
    console.error('Использование: node scripts/release-bump.cjs <base> [head]');
    process.exit(2);
  }
  const previous = releasedVersion(base);
  if (!previous) {
    console.error(`У ${base} нет тега выпуска vX.Y.Z — не от чего считать.`);
    process.exit(2);
  }
  const { level, reasons, counted } = suggestBump(releaseCommits(base, head), previous);
  if (!level) {
    console.log(`Выпускать нечего: в ${base}..${head} только служебные коммиты.`);
    process.exit(0);
  }
  console.log(
    `Выпуск: ${previous} → ${bumpVersion(previous, level)} (${level}), коммитов: ${counted}`
  );
  for (const reason of reasons.slice(0, 15)) console.log(`  • ${reason}`);
  if (reasons.length > 15) console.log(`  … и ещё ${reasons.length - 15}`);
  console.log(`Команда: npm run release:version -- ${level}`);
}
