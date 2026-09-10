/**
 * Generate a new researcher_api password and write gitignored operator artifacts.
 * Does not connect to the database or print the password.
 *
 * Merges DATABASE_URL into .env.synthetic.local without wiping other keys
 * (for example SYNTHETIC_OPERATOR_DATABASE_URL / SUBMISSION_DATABASE_URL).
 *
 * Prefer removing elevated operator URLs from disk when they are no longer
 * needed for reproducible ops. Never commit .env*.local or .operator/*.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'sqsekdfcpbvycqtlyinm';
const DB_USER = `researcher_api.${PROJECT_REF}`;
const DB_HOST = 'aws-0-ap-southeast-1.pooler.supabase.com';
const DB_PORT = '6543';
const DB_NAME = 'postgres';

function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

function escapeSqlPassword(password) {
  return password.replace(/'/g, "''");
}

function parseEnvFile(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    map.set(trimmed.slice(0, i), trimmed.slice(i + 1));
  }
  return map;
}

function serializeEnv(map) {
  const preferred = [
    'DATABASE_URL',
    'DATABASE_CA_CERT',
    'SUBMISSION_DATABASE_URL',
    'SUBMISSION_DATABASE_CA_CERT',
    'SYNTHETIC_OPERATOR_DATABASE_URL',
  ];
  const lines = [];
  const seen = new Set();
  for (const key of preferred) {
    if (!map.has(key)) continue;
    lines.push(`${key}=${map.get(key)}`);
    seen.add(key);
  }
  for (const [key, value] of map.entries()) {
    if (seen.has(key)) continue;
    lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeRestricted(path, content) {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not support Unix mode bits; file content is still written.
  }
}

function main() {
  const root = repoRoot();
  const envPath = join(root, '.env.synthetic.local');
  const operatorDir = join(root, '.operator');
  const sqlPath = join(operatorDir, 'rotate-researcher_api.sql.local');

  const existing = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : new Map();
  const password = randomBytes(32).toString('base64url');
  const encodedPassword = encodeURIComponent(password);
  const databaseUrl = `postgresql://${DB_USER}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

  existing.set('DATABASE_URL', databaseUrl);
  if (!existing.has('DATABASE_CA_CERT')) {
    existing.set('DATABASE_CA_CERT', '');
  }

  writeRestricted(envPath, serializeEnv(existing));

  mkdirSync(operatorDir, { recursive: true });
  const sqlContent = `-- Run in Supabase SQL Editor as postgres/superuser. Rotates researcher_api only.
-- Do not commit this file. Delete after use.
ALTER ROLE researcher_api WITH PASSWORD '${escapeSqlPassword(password)}';
`;
  writeRestricted(sqlPath, sqlContent);

  console.log('Password generated: yes (not shown)');
  console.log(`Updated: ${envPath} (merged; other keys preserved)`);
  console.log(`SQL file: ${sqlPath}`);
  console.log('Next: run the SQL in Supabase SQL Editor, then update Vercel Preview DATABASE_URL.');
  console.log(
    'Guidance: keep SYNTHETIC_OPERATOR_DATABASE_URL off disk when seed/cleanup is not actively needed.'
  );
}

main();
