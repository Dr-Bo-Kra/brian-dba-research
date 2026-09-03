#!/usr/bin/env node
/**
 * Operator-only cleanup for the reserved synthetic assessment batch.
 * Requires --confirm-synthetic-cleanup. Refuses broad or ambiguous deletes.
 *
 * Real deletes use SYNTHETIC_OPERATOR_DATABASE_URL only.
 * Dry-run / inspect prefers the operator URL when present; otherwise falls
 * back to DATABASE_URL for read-only inspection (researcher_api SELECT).
 */
import {
  SYNTHETIC_BATCH_ID,
  SYNTHETIC_RESPONSE_COUNT,
  isSyntheticReference,
} from './lib/synthetic-batch.mjs';
import {
  loadOperatorEnv,
  logOperatorDatabaseIdentity,
} from './lib/load-operator-env.mjs';
import {
  SYNTHETIC_REF_SQL_PATTERN,
  countSyntheticRows,
  createOperatorPool,
  listSyntheticRows,
  parseOperatorArgs,
  resolveInspectDatabaseUrl,
  resolveWriteDatabaseUrl,
  verifyAssessmentSchema,
} from './lib/synthetic-db.mjs';

function usage() {
  console.log(`Usage: node scripts/cleanup-synthetic-responses.mjs [--dry-run] [--confirm-synthetic-cleanup]

Deletes assessment_responses rows whose client_record_id matches:
  ${SYNTHETIC_REF_SQL_PATTERN}

Safety:
  • Requires --confirm-synthetic-cleanup (unless --dry-run)
  • Refuses when matched row count exceeds ${SYNTHETIC_RESPONSE_COUNT}
  • Never deletes rows outside the reserved synthetic prefix
  • Real cleanup requires SYNTHETIC_OPERATOR_DATABASE_URL (not researcher_api DELETE)
  • Dry-run inspect prefers operator URL, else falls back to DATABASE_URL (read-only)

Environment (shell or gitignored local file):
  .env.synthetic.local  preferred operator file (never committed)
  .env.local            fallback operator file (never committed)
  SYNTHETIC_OPERATOR_DATABASE_URL  write credential for seed/cleanup only
  DATABASE_URL          researcher_api URI (inspect fallback only)
  DATABASE_CA_CERT      PEM CA for remote TLS (required for non-local hosts)`);
}

async function main() {
  const loadedFrom = loadOperatorEnv();
  const args = parseOperatorArgs(process.argv.slice(2));
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const writeMode = Boolean(args.confirmCleanup && !args.dryRun);

  let resolved;
  try {
    if (writeMode) {
      const url = resolveWriteDatabaseUrl();
      resolved = { url, source: 'operator' };
    } else {
      resolved = resolveInspectDatabaseUrl();
    }
  } catch (err) {
    if (args.dryRun) {
      console.log('Dry run — database unavailable; cannot inspect existing synthetic rows.');
      console.log(`Would delete rows matching: ${SYNTHETIC_REF_SQL_PATTERN}`);
      console.log(
        'Inspect uses SYNTHETIC_OPERATOR_DATABASE_URL when set, else DATABASE_URL (read-only).'
      );
      return;
    }
    console.error(`Refusing to cleanup: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  logOperatorDatabaseIdentity(loadedFrom, resolved);

  let pool;
  try {
    pool = createOperatorPool(resolved.url);
  } catch (err) {
    if (args.dryRun) {
      console.log('Dry run — database unavailable; cannot inspect existing synthetic rows.');
      console.log(`Would delete rows matching: ${SYNTHETIC_REF_SQL_PATTERN}`);
      return;
    }
    console.error(`Refusing to cleanup: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await verifyAssessmentSchema(client);
    const rows = await listSyntheticRows(client);
    const count = rows.length;

    if (count > SYNTHETIC_RESPONSE_COUNT) {
      console.error(
        `Refusing cleanup: ${count} rows match the synthetic prefix (cap ${SYNTHETIC_RESPONSE_COUNT}). Investigate manually.`
      );
      process.exitCode = 1;
      return;
    }

    for (const row of rows) {
      if (!isSyntheticReference(row.client_record_id)) {
        console.error(`Refusing cleanup: unexpected reference ${row.client_record_id}`);
        process.exitCode = 1;
        return;
      }
    }

    if (args.dryRun) {
      console.log('Dry run — no database writes.');
      console.log(`Batch: ${SYNTHETIC_BATCH_ID}`);
      console.log(`Inspect source: ${resolved.source}`);
      console.log(`Rows that would be deleted: ${count}`);
      for (const row of rows.slice(0, 5)) {
        console.log(`  ${row.client_record_id}  ${row.created_at}`);
      }
      if (count > 5) console.log(`  … (${count - 5} more)`);
      return;
    }

    if (!args.confirmCleanup) {
      console.error('Refusing to cleanup: pass --confirm-synthetic-cleanup or use --dry-run.');
      process.exitCode = 1;
      return;
    }

    if (count === 0) {
      console.log('No synthetic rows matched; nothing to delete.');
      return;
    }

    await client.query('begin');
    const result = await client.query(
      `delete from public.assessment_responses
        where client_record_id ~ $1
          and legal_hold is not true
          and anonymised_at is null`,
      [SYNTHETIC_REF_SQL_PATTERN]
    );
    await client.query('commit');

    const remaining = await countSyntheticRows(client);
    console.log(`Deleted ${result.rowCount} synthetic row(s) for batch ${SYNTHETIC_BATCH_ID}.`);
    console.log(`Remaining synthetic rows: ${remaining}`);
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* ignore rollback failure */
    }
    console.error(`Cleanup failed: ${err.message || err}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
