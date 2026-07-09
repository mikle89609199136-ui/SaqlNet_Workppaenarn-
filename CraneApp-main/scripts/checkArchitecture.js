const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const syntaxRoots = [
  'client/mobile/core',
  'client/mobile/domain',
  'client/mobile/application',
  'client/mobile/infrastructure',
  'client/mobile/shared',
  'client/mobile/presentation',
  'server/gateway',
  'server/services/message-service',
];

const sizeLimits = [
  { file: 'server/gateway/apiGateway.js', maxLines: 700 },
  { file: 'client/mobile/screens/chats/chats.js', maxLines: 700 },
  { file: 'client/mobile/screens/chats/chats.html', maxLines: 700 },
  { file: 'client/mobile/scripts/i18n.js', maxLines: 700 },
  { file: 'client/mobile/components/media-editor/photo-editor.js', maxLines: 700 },
  { file: 'client/mobile/styles/chats.css', maxLines: 700 },
  { file: 'client/mobile/styles/global.css', maxLines: 700 },
];
const microserviceRoots = [
  'client/mobile/core',
  'client/mobile/domain',
  'client/mobile/application',
  'client/mobile/infrastructure',
  'client/mobile/shared',
  'client/mobile/presentation',
  'server/gateway/routes',
  'server/gateway/middleware',
  'server/gateway/services',
];
const MICROSERVICE_MAX_LINES = 500;
const SOURCE_MAX_LINES = 700;
const sourceExtensions = new Set([
  '.chunk',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
]);
const sourceRoots = [
  'client',
  'database',
  'docs',
  'infrastructure',
  'public',
  'scripts',
  'server',
];
const largeSourceAllowlist = new Set([
  'client/mobile/screens/chats/chats.html',
  'client/mobile/screens/chats/chats_v5.js',
  'client/mobile/styles/chats_v5.css',
]);

let failed = false;

for (const file of listJavaScriptFiles(syntaxRoots)) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax check failed: ${path.relative(ROOT, file)}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
  }
}

for (const limit of sizeLimits) {
  const absolutePath = path.join(ROOT, limit.file);
  if (!fs.existsSync(absolutePath)) continue;
  if (largeSourceAllowlist.has(limit.file)) continue;

  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).length;
  if (lines > limit.maxLines) {
    failed = true;
    console.error(`Monolith limit exceeded: ${limit.file} has ${lines} lines, limit is ${limit.maxLines}`);
  }
}

for (const file of listJavaScriptFiles(microserviceRoots)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  if (lines > MICROSERVICE_MAX_LINES) {
    failed = true;
    console.error(
      `Microservice file too large: ${path.relative(ROOT, file)} has ${lines} lines, limit is ${MICROSERVICE_MAX_LINES}`
    );
  }
}

for (const file of listSourceFiles(sourceRoots)) {
  const relativeFile = path.relative(ROOT, file);
  if (largeSourceAllowlist.has(relativeFile)) continue;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  if (lines > SOURCE_MAX_LINES) {
    failed = true;
    console.error(
      `Source file too large: ${relativeFile} has ${lines} lines, limit is ${SOURCE_MAX_LINES}`
    );
  }
}

if (failed) {
  process.exit(1);
}

console.log('Architecture checks passed.');

function listJavaScriptFiles(relativeRoots) {
  return relativeRoots.flatMap((relativeRoot) => {
    const absoluteRoot = path.join(ROOT, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) return [];
    return walk(absoluteRoot).filter((file) => file.endsWith('.js'));
  });
}

function listSourceFiles(relativeRoots) {
  return relativeRoots.flatMap((relativeRoot) => {
    const absoluteRoot = path.join(ROOT, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) return [];
    return walk(absoluteRoot).filter((file) => sourceExtensions.has(path.extname(file)));
  });
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}
