/* Какую часть версии поднять в выпуске (#892): node --test scripts/ */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bumpLevel, bumpVersion, suggestBump } = require('./release-bump.cjs');

const commits = (...subjects) => subjects.map((subject) => ({ subject, body: '' }));

test('есть feat — minor', () => {
  const { level, reasons } = suggestBump(
    commits('fix(chat): typo (#1)', 'feat(pwa): update without reinstalling (#892)'),
    '0.9.0'
  );
  assert.equal(level, 'minor');
  assert.deepEqual(reasons, ['новое: feat(pwa): update without reinstalling (#892)']);
});

test('только исправления, рефакторинг, документация — patch', () => {
  const { level } = suggestBump(
    commits(
      'fix(push): single mailto (#889)',
      'refactor(ui): list rows',
      'docs: runbook',
      'perf: faster list'
    ),
    '0.10.0'
  );
  assert.equal(level, 'patch');
});

test('ломающее изменение: до 1.0 — minor, после — major', () => {
  const breaking = commits('feat(api)!: new message contract');
  assert.equal(suggestBump(breaking, '0.10.0').level, 'minor');
  assert.equal(suggestBump(breaking, '1.2.0').level, 'major');

  const inBody = [{ subject: 'fix(auth): tokens', body: 'BREAKING CHANGE: old tokens rejected' }];
  assert.equal(suggestBump(inBody, '1.2.0').level, 'major');
});

test('служебные коммиты выпуска не считаются; кроме них ничего — выпускать нечего', () => {
  const service = commits(
    'release: dev → master (28.09)',
    'chore(release): 0.10.0',
    'chore: sync master into dev (#888)',
    'merge: sync dev into master'
  );
  assert.equal(suggestBump(service, '0.10.0').level, null);
  assert.equal(suggestBump([...service, ...commits('fix: x')], '0.10.0').level, 'patch');
});

test('следующий номер и какая часть поднята', () => {
  assert.equal(bumpVersion('0.9.0', 'minor'), '0.10.0');
  assert.equal(bumpVersion('0.10.3', 'patch'), '0.10.4');
  assert.equal(bumpVersion('0.10.3', 'major'), '1.0.0');

  assert.equal(bumpLevel('0.9.0', '0.10.0'), 'minor');
  assert.equal(bumpLevel('0.9.0', '0.9.1'), 'patch');
  assert.equal(bumpLevel('0.9.0', '1.0.0'), 'major');
  assert.equal(bumpLevel('0.10.0', '0.10.0'), null);
  assert.equal(bumpLevel('0.10.0', '0.9.9'), null);
});
