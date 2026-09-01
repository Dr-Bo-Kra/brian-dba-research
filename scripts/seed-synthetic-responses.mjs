#!/usr/bin/env node
/**
 * Operator-only synthetic seed for dashboard validation.
 * Requires --confirm-synthetic-seed. Never invoked from browser/UI or deploy hooks.
 */
import {
  INSERT_SQL,
  SYNTHETIC_BATCH_ID,
  SYNTHETIC_RESPONSE_COUNT,
  batchDistributionSummary,
  buildSyntheticBatch,
  isSyntheticReference,
  toInsertRow,
} from './lib/synthetic-batch.mjs';
import {
  countSyntheticRows,
  createOperatorPool,
  parseOperatorArgs,
  safeDatabaseIdentity,
  verifyAssessmentSchema,
} from './lib/synthetic-db.mjs';

function usage() {
  console.log(`Usage: node scripts/seed-synthetic-responses.mjs [--dry-run] [--confirm-synthetic-seed]

Seeds ${SYNTHETIC_RESPONSE_COUNT} deterministic synthetic assessment_responses rows
for batch "${SYNTHETIC_BATCH_ID}".

Safety:
  • Requires --confirm-synthetic-seed (unless --dry-run)
  • Refuses when synthetic rows already exist
  • Uses reserved client_record_id prefix resp_00000000-0000-4000-8000-…
  • Requires DATABASE_URL (operator credential with INSERT on assessment_responses)

Environment:
  DATABASE_URL       PostgreSQL connection string (not service_role)
  DATABASE_CA_CERT   PEM CA for remote TLS (optional for localhost)`);
}

function printDryRunSummary(records) {
  const distribution = batchDistributionSummary(records);
  console.log('Dry run — no database writes.');
  console.log(`Batch: ${SYNTHETIC_BATCH_ID}`);
  console.log(`Rows to insert: ${records.length}`);
  console.log(`Qualitative rows: ${distribution.qualitativeCount}`);
  console.log(`Last-24h rows (reference clock): ${distribution.last24h}`);
  console.log('Sample references:');
  for (const record of records.slice(0, 3)) {
    console.log(`  ${record.client_record_id}  ${record.created_at}`);
  }
  console.log(`  … (${records.length - 3} more)`);
}

async function main() {
  const args = parseOperatorArgs(process.argv.slice(2));
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const records = buildSyntheticBatch();
  for (const record of records) {
    if (!isSyntheticReference(record.client_record_id)) {
      throw new Error('generator_produced_non_synthetic_reference');
    }
  }

  if (args.dryRun) {
    printDryRunSummary(records);
    return;
  }

  if (!args.confirmSeed) {
    console.error('Refusing to seed: pass --confirm-synthetic-seed or use --dry-run.');
    process.exitCode = 1;
    return;
  }

  let pool;
  try {
    pool = createOperatorPool();
  } catch (err) {
    console.error(`Refusing to seed: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  const identity = safeDatabaseIdentity(process.env.DATABASE_URL || '');
  console.log('Target database (no secrets):', identity);

  const client = await pool.connect();
  try {
    await verifyAssessmentSchema(client);
    const existing = await countSyntheticRows(client);
    if (existing > 0) {
      console.error(
        `Refusing to seed: found ${existing} existing synthetic row(s). Run cleanup first.`
      );
      process.exitCode = 1;
      return;
    }

    await client.query('begin');
    for (const record of records) {
      const row = toInsertRow(record);
      await client.query(INSERT_SQL, [
        row.created_at,
        row.instrument_id,
        row.client_record_id,
        JSON.stringify(row.profile),
        JSON.stringify(row.responses),
        JSON.stringify(row.assessment),
        row.privacy_notice_version,
        row.consented_at,
      ]);
    }
    await client.query('commit');

    const inserted = await countSyntheticRows(client);
    const distribution = batchDistributionSummary(records);
    console.log(`Seeded ${inserted} synthetic responses for batch ${SYNTHETIC_BATCH_ID}.`);
    console.log(`Qualitative rows: ${distribution.qualitativeCount}`);
    console.log(`Last-24h rows (reference clock): ${distribution.last24h}`);
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* ignore rollback failure */
    }
    console.error(`Seed failed: ${err.message || err}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
