/**
 * Load operator-only secrets from gitignored local env files.
 * Shell environment wins; files never override existing process.env keys.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeDatabaseIdentity } from './synthetic-db.mjs';

const OPERATOR_ENV_FILES = ['.env.synthetic.local', '.env.local'];
const OPERATOR_KEYS = new Set(['DATABASE_URL', 'DATABASE_CA_CERT', 'SUPABASE_DB_CA']);

function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function parseEnvFile(content) {
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!OPERATOR_KEYS.has(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Load DATABASE_URL and CA cert vars from operator env files.
 * @returns {Record<string, string>} map of loaded keys to source filename
 */
export function loadOperatorEnv() {
  const root = repoRoot();
  const loadedFrom = {};

  for (const name of OPERATOR_ENV_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const vars = parseEnvFile(readFileSync(path, 'utf8'));
    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key]) continue;
      process.env[key] = value;
      loadedFrom[key] = name;
    }
  }

  return loadedFrom;
}

/**
 * Log safe database identity (host, db, user — never password or full URL).
 */
export function logOperatorDatabaseIdentity(loadedFrom = {}) {
  const url = process.env.DATABASE_URL || '';
  if (!url) return;
  const identity = safeDatabaseIdentity(url);
  const source = loadedFrom.DATABASE_URL ? `file ${loadedFrom.DATABASE_URL}` : 'shell env';
  console.log(`Operator DATABASE_URL (${source}, no secrets):`, identity);
}
