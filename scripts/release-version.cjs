#!/usr/bin/env node
/*
 * Номер версии выпуска (#892): `npm run release:version -- minor` (выпуск
 * dev → master), `-- patch` (исправление прямо в master) или точный номер
 * `-- 0.10.1` (откат: содержимое прежнее, номер — вперёд).
 *
 * Источник версии — frontend/package.json: её показывает приложение, её
 * сравнивает проверка выпуска в CI. Корневой package.json повторяет её,
 * чтобы в репозитории не было двух разных номеров.
 */
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const bump = process.argv[2];
if (!['major', 'minor', 'patch'].includes(bump) && !/^\d+\.\d+\.\d+$/.test(bump ?? '')) {
  console.error('Использование: npm run release:version -- minor|patch|X.Y.Z');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const run = (cwd, version) =>
  execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, {
    cwd,
    stdio: 'ignore',
  });

run(frontend, bump);
const { version } = JSON.parse(readFileSync(path.join(frontend, 'package.json'), 'utf8'));
run(root, version);
console.log(version);
