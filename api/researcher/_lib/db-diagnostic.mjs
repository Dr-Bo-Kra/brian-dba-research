/**
 * Temporary Preview-only database identity check.
 * Catalog metadata only. Never SELECT survey rows or return secrets.
 */
import { assertBoundQuery } from './db.mjs';
import { classifyQueryError } from './query.mjs';

export const RESEARCHER_API_ROLE = 'researcher_api';
export const EXPECTED_DATABASE = 'postgres';

export const DIAGNOSTIC_STAGES = Object.freeze([
  'connect',
  'identity',
  'rls',
  'policies',
  'grants',
  'browser_grants',
  'function_privilege',
]);

export const DIAGNOSTIC_CATEGORIES = Object.freeze([
  'authentication_failed',
  'permission_denied',
  'connection_failed',
  'query_failed',
]);

export const DIAGNOSTIC_TABLES = Object.freeze([
  'assessment_responses',
  'authorised_researchers',
  'researcher_sessions',
  'researcher_auth_states',
  'researcher_rate_limits',
  'researcher_audit_events',
]);

const EXPECTED_PRIVILEGES = Object.freeze({
  assessment_responses: Object.freeze({ select: true, insert: false, update: false, delete: false }),
  authorised_researchers: Object.freeze({ select: true, insert: false, update: false, delete: false }),
  researcher_sessions: Object.freeze({ select: true, insert: true, update: true, delete: true }),
  researcher_auth_states: Object.freeze({ select: true, insert: true, update: true, delete: false }),
  researcher_rate_limits: Object.freeze({ select: true, insert: true, update: true, delete: false }),
  researcher_audit_events: Object.freeze({ select: false, insert: true, update: false, delete: false }),
});

const EXPECTED_POLICIES = Object.freeze([
  'researcher_api_select_assessment_responses',
  'researcher_api_select_authorised_researchers',
  'researcher_api_select_sessions',
  'researcher_api_insert_sessions',
  'researcher_api_update_sessions',
  'researcher_api_delete_sessions',
  'researcher_api_select_auth_states',
  'researcher_api_insert_auth_states',
  'researcher_api_update_auth_states',
  'researcher_api_select_rate_limits',
  'researcher_api_insert_rate_limits',
  'researcher_api_update_rate_limits',
  'researcher_api_insert_audit',
]);

export const DIAGNOSTIC_SQL = Object.freeze({
  connect: {
    text: `select 1 as ok`,
  },
  identity: {
    text: `select current_user as database_user,
                  current_database() as database_name,
                  r.rolsuper as is_superuser,
                  r.rolbypassrls as bypass_rls
           from pg_roles r
           where r.rolname = current_user
           limit 1`,
  },
  rls: {
    text: `select c.relname as table_name,
                  c.relrowsecurity as rls,
                  c.relforcerowsecurity as force_rls
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relkind = 'r'
             and c.relname = any($1::text[])`,
  },
  privileges: {
    text: `select t.table_name,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'SELECT') as can_select,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'INSERT') as can_insert,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'UPDATE') as can_update,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'DELETE') as can_delete,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'TRUNCATE') as can_truncate,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'REFERENCES') as can_references,
                  has_table_privilege(current_user, format('public.%I', t.table_name), 'TRIGGER') as can_trigger
           from unnest($1::text[]) as t(table_name)`,
  },
  browserGrants: {
    text: `select c.relname as table_name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = any($1::text[])
             and exists (
               select 1
               from aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
               join pg_roles gr on gr.oid = a.grantee
               where gr.rolname in ('anon', 'authenticated')
             )`,
  },
  policies: {
    text: `select p.polname as policy_name
           from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = any($1::text[])`,
  },
  deleteExecute: {
    text: `select has_function_privilege(
             current_user,
             'public.delete_assessment_by_reference(text)',
             'EXECUTE'
           ) as can_execute`,
  },
});

Object.freeze(DIAGNOSTIC_SQL.connect);
Object.freeze(DIAGNOSTIC_SQL.identity);
Object.freeze(DIAGNOSTIC_SQL.rls);
Object.freeze(DIAGNOSTIC_SQL.privileges);
Object.freeze(DIAGNOSTIC_SQL.browserGrants);
Object.freeze(DIAGNOSTIC_SQL.policies);
Object.freeze(DIAGNOSTIC_SQL.deleteExecute);

export function isDbDiagnosticAllowed(config = {}) {
  if (config.dbDiagnosticEnabled !== true) return false;
  const vercelEnv = String(config.vercelEnv || '').toLowerCase();
  return vercelEnv === 'preview' || vercelEnv === 'development';
}

function safeStage(stage) {
  return DIAGNOSTIC_STAGES.includes(stage) ? stage : 'connect';
}

function safeCategory(category) {
  return DIAGNOSTIC_CATEGORIES.includes(category) ? category : 'query_failed';
}

export function logDiagnosticFailure({ stage, category } = {}) {
  console.error(
    JSON.stringify({
      diagnostic: 'db',
      ok: false,
      stage: safeStage(stage),
      category: safeCategory(category),
    })
  );
}

function compactSuccess({ databaseUser, database, superuser, bypassRls, rlsVerified, grantsVerified }) {
  return {
    ok: true,
    databaseUser,
    database,
    superuser,
    bypassRls,
    rlsVerified,
    grantsVerified,
  };
}

function asBool(value) {
  return value === true;
}

function privilegesMatch(row) {
  const expected = EXPECTED_PRIVILEGES[row.table_name];
  if (!expected) return false;
  return (
    asBool(row.can_select) === expected.select &&
    asBool(row.can_insert) === expected.insert &&
    asBool(row.can_update) === expected.update &&
    asBool(row.can_delete) === expected.delete &&
    asBool(row.can_truncate) === false &&
    asBool(row.can_references) === false &&
    asBool(row.can_trigger) === false
  );
}

function failedCheck(stage, category = 'query_failed') {
  return { ok: false, stage: safeStage(stage), category: safeCategory(category) };
}

function stagedFailure(err, stage) {
  const wrapped = Object.assign(new Error('unavailable'), {
    code: 'unavailable',
    stage: safeStage(stage),
    category: classifyQueryError(err),
  });
  throw wrapped;
}

async function stagedQuery(query, spec, params, stage) {
  try {
    return await query(spec, params);
  } catch (err) {
    stagedFailure(err, stage);
  }
}

export async function runDbDiagnostic(query) {
  if (typeof query !== 'function') {
    return failedCheck('connect', 'connection_failed');
  }
  for (const spec of Object.values(DIAGNOSTIC_SQL)) {
    assertBoundQuery(spec);
  }

  try {
    await stagedQuery(query, DIAGNOSTIC_SQL.connect, [], 'connect');

    const identity = await stagedQuery(query, DIAGNOSTIC_SQL.identity, [], 'identity');
    const identityRow = identity?.rows?.[0];
    if (!identityRow) return failedCheck('identity');
    if (identityRow.database_user !== RESEARCHER_API_ROLE) return failedCheck('identity');
    if (identityRow.database_name !== EXPECTED_DATABASE) return failedCheck('identity');
    if (asBool(identityRow.is_superuser)) return failedCheck('identity');
    if (asBool(identityRow.bypass_rls)) return failedCheck('identity');

    const tables = [...DIAGNOSTIC_TABLES];
    const rls = await stagedQuery(query, DIAGNOSTIC_SQL.rls, [tables], 'rls');
    const rlsRows = rls?.rows || [];
    const rlsByTable = new Map(rlsRows.map((row) => [row.table_name, row]));
    const rlsVerified =
      tables.every((name) => {
        const row = rlsByTable.get(name);
        return row && asBool(row.rls) && asBool(row.force_rls);
      }) && rlsRows.length === tables.length;
    if (!rlsVerified) return failedCheck('rls');

    const policies = await stagedQuery(query, DIAGNOSTIC_SQL.policies, [tables], 'policies');
    const presentPolicies = new Set((policies?.rows || []).map((row) => row.policy_name));
    const policiesVerified = EXPECTED_POLICIES.every((name) => presentPolicies.has(name));
    if (!policiesVerified) return failedCheck('policies');

    const privileges = await stagedQuery(query, DIAGNOSTIC_SQL.privileges, [tables], 'grants');
    const privilegeRows = privileges?.rows || [];
    const privilegeByTable = new Map(privilegeRows.map((row) => [row.table_name, row]));
    const tableGrantsVerified =
      tables.every((name) => privilegesMatch(privilegeByTable.get(name) || { table_name: name })) &&
      privilegeRows.length === tables.length;
    if (!tableGrantsVerified) return failedCheck('grants');

    const browserGrants = await stagedQuery(query, DIAGNOSTIC_SQL.browserGrants, [tables], 'browser_grants');
    const browserGrantsVerified = (browserGrants?.rows || []).length === 0;
    if (!browserGrantsVerified) return failedCheck('browser_grants');

    const deleteExecute = await stagedQuery(query, DIAGNOSTIC_SQL.deleteExecute, [], 'function_privilege');
    const deleteExecuteVerified = asBool(deleteExecute?.rows?.[0]?.can_execute) === false;
    if (!deleteExecuteVerified) return failedCheck('function_privilege');

    return {
      ok: true,
      result: compactSuccess({
        databaseUser: RESEARCHER_API_ROLE,
        database: EXPECTED_DATABASE,
        superuser: false,
        bypassRls: false,
        rlsVerified: true,
        grantsVerified: true,
      }),
    };
  } catch (err) {
    return failedCheck(err?.stage, classifyQueryError(err));
  }
}
