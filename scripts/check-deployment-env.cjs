// Read-only deployment diagnostics. Never print credentials or raw errors.
const fs = require('node:fs');
const net = require('node:net');
const dotenv = require('dotenv');
const { Client } = require('pg');

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--env-file');
const file = fileIndex >= 0 ? args[fileIndex + 1] : '.env';
if (fileIndex >= 0 && (!file || file.startsWith('--'))) {
  console.error('Usage: node scripts/check-deployment-env.cjs [--env-file PATH] [--check]');
  process.exit(1);
}
let values = {};
if (fs.existsSync(file)) values = dotenv.parse(fs.readFileSync(file));
const env = { ...values, ...process.env };
const endpoints = {
  DATABASE_URL: 5432,
  REDIS_URL: 6379,
  NATS_URL: 4222,
  MINIO_ENDPOINT: 443,
};
let failed = false;

function tcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(3000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function main() {
  for (const [key, defaultPort] of Object.entries(endpoints)) {
    if (!env[key]) { console.log(`${key}: MISSING`); failed = true; continue; }
    let url;
    try { url = new URL(env[key]); }
    catch { console.log(`${key}: INVALID URL (value hidden)`); failed = true; continue; }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(url.port || (url.protocol === 'http:' ? 80 : defaultPort));
    console.log(`${key}: ${url.protocol}//${url.hostname}:${port}; login=${url.username ? 'set' : 'absent'}; password=${url.password ? 'set' : 'absent'}`);
    if (['localhost', '127.0.0.1', '::1'].includes(host)) {
      console.log('  LOCAL ADDRESS: unavailable from Vercel as an external resource');
    }
    if (!args.includes('--check')) continue;
    const reachable = await tcp(host, port);
    console.log(`  TCP: ${reachable ? 'OK' : 'FAILED'}`);
    if (!reachable) { failed = true; continue; }
    if (key === 'DATABASE_URL') {
      const client = new Client({ connectionString: env[key], connectionTimeoutMillis: 3000, query_timeout: 3000 });
      try {
        await client.connect();
        await client.query('SELECT 1');
        console.log('  PostgreSQL authentication + SELECT 1: OK');
      } catch (error) {
        // Error messages may contain URLs or credentials. Allowlist SQLSTATE only.
        const code = /^[0-9A-Z]{5}$/.test(error.code || '') ? `; SQLSTATE=${error.code}` : '';
        console.log(`  PostgreSQL authentication/query: FAILED${code}`);
        failed = true;
      } finally { await client.end().catch(() => {}); }
    } else {
      console.log('  TCP only: authentication and TLS not verified');
    }
  }
  for (const key of ['CRYPTO_SIGNING_SECRET', 'CRYPTO_ENCRYPTION_SECRET', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_REGION', 'MEDIA_BUCKET', 'MAX_FILE_SIZE', 'ALLOWED_ORIGINS']) {
    console.log(`${key}: ${env[key] ? 'SET (value hidden)' : 'MISSING'}`);
    if (!env[key]) failed = true;
  }
  if (failed) process.exitCode = 1;
}

main().catch(() => { console.error('Diagnostics failed (details hidden)'); process.exitCode = 1; });
