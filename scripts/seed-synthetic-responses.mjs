#!/usr/bin/env node
/**
 * Operator-only synthetic seed for dashboard validation.
 * Requires --confirm-synthetic-seed. Never invoked from browser/UI or deploy hooks.
 *
 * Real writes use SYNTHETIC_OPERATOR_DATABASE_URL only (not researcher_api).
 * Dry-run does not connect to the database.
 */
import {
  INSERT_SQL,
  SYNTHETIC_BATCH_ID,
  SYNTHETIC_RESPONSE_COUNT,
  batchDistributionSummary,
  buildSyntheticBatch,
  isSyntheticReference,
  resolveSyntheticReferenceNow,
  toInsertRow,
} from './lib/synthetic-batch.mjs';
import {
  loadOperatorEnv,
  logOperatorDatabaseIdentity,
} from './lib/load-operator-env.mjs';
import {
  countSyntheticRows,
  createOperatorPool,
  parseOperatorArgs,
  resolveWriteDatabaseUrl,
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
  • Real seed requires SYNTHETIC_OPERATOR_DATABASE_URL (not researcher_api INSERT)

Environment (shell or gitignored local file):
  .env.synthetic.local  preferred operator file (never committed)
  .env.local            fallback operator file (never committed)
  SYNTHETIC_OPERATOR_DATABASE_URL  write credential for seed/cleanup only
  DATABASE_URL          researcher_api URI (unchanged; not used for seed writes)
  DATABASE_CA_CERT      PEM CA for remote TLS (required for non-local hosts)`);
}

function printDryRunSummary(records, referenceNow) {
  const distribution = batchDistributionSummary(records, { referenceNow });
  console.log('Dry run — no database writes.');
  console.log(`Batch: ${SYNTHETIC_BATCH_ID}`);
  console.log(`Reference now: ${referenceNow}`);
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
  const loadedFrom = loadOperatorEnv();
  const args = parseOperatorArgs(process.argv.slice(2));
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  // Real operator seed uses wall-clock seed time so last-24h KPIs stay meaningful.
  // Tests inject SYNTHETIC_REFERENCE_NOW / options.referenceNow for determinism.
  // Dry-run keeps the fixed default clock unless SYNTHETIC_REFERENCE_NOW is set.
  const referenceNow = args.dryRun ? resolveSyntheticReferenceNow() : new Date().toISOString();
  const records = buildSyntheticBatch({ referenceNow });
  for (const record of records) {
    if (!isSyntheticReference(record.client_record_id)) {
      throw new Error('generator_produced_non_synthetic_reference');
    }
  }

  if (args.dryRun) {
    printDryRunSummary(records, referenceNow);
    return;
  }

  if (!args.confirmSeed) {
    console.error('Refusing to seed: pass --confirm-synthetic-seed or use --dry-run.');
    process.exitCode = 1;
    return;
  }

  let writeUrl;
  try {
    writeUrl = resolveWriteDatabaseUrl();
  } catch (err) {
    console.error(`Refusing to seed: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  logOperatorDatabaseIdentity(loadedFrom, { url: writeUrl, source: 'operator' });

  let pool;
  try {
    pool = createOperatorPool(writeUrl);
  } catch (err) {
    console.error(`Refusing to seed: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

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
    const distribution = batchDistributionSummary(records, { referenceNow });
    console.log(`Seeded ${inserted} synthetic responses for batch ${SYNTHETIC_BATCH_ID}.`);
    console.log(`Reference now: ${referenceNow}`);
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
