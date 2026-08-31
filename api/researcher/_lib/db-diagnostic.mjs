/**
 * Temporary Preview-only database identity check.
 * Catalog metadata only. Never SELECT survey rows or return secrets.
 */
import { assertBoundQuery } from './db.mjs';

export const RESEARCHER_API_ROLE = 'researcher_api';
export const EXPECTED_DATABASE = 'postgres';

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

export function logDiagnosticFailure(reason) {
  console.error(JSON.stringify({ diagnostic: 'db', ok: false, reason: String(reason || 'failed') }));
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

export async function runDbDiagnostic(query) {
  if (typeof query !== 'function') {
    return { ok: false, reason: 'missing_query' };
  }
  for (const spec of Object.values(DIAGNOSTIC_SQL)) {
    assertBoundQuery(spec);
  }

  const identity = await query(DIAGNOSTIC_SQL.identity, []);
  const identityRow = identity?.rows?.[0];
  if (!identityRow) return { ok: false, reason: 'identity' };
  if (identityRow.database_user !== RESEARCHER_API_ROLE) {
    return { ok: false, reason: 'wrong_user' };
  }
  if (identityRow.database_name !== EXPECTED_DATABASE) {
    return { ok: false, reason: 'wrong_database' };
  }
  if (asBool(identityRow.is_superuser)) return { ok: false, reason: 'superuser' };
  if (asBool(identityRow.bypass_rls)) return { ok: false, reason: 'bypass_rls' };

  const tables = [...DIAGNOSTIC_TABLES];
  const rls = await query(DIAGNOSTIC_SQL.rls, [tables]);
  const rlsRows = rls?.rows || [];
  const rlsByTable = new Map(rlsRows.map((row) => [row.table_name, row]));
  const rlsVerified =
    tables.every((name) => {
      const row = rlsByTable.get(name);
      return row && asBool(row.rls) && asBool(row.force_rls);
    }) && rlsRows.length === tables.length;

  const policies = await query(DIAGNOSTIC_SQL.policies, [tables]);
  const presentPolicies = new Set((policies?.rows || []).map((row) => row.policy_name));
  const policiesVerified = EXPECTED_POLICIES.every((name) => presentPolicies.has(name));

  const privileges = await query(DIAGNOSTIC_SQL.privileges, [tables]);
  const privilegeRows = privileges?.rows || [];
  const privilegeByTable = new Map(privilegeRows.map((row) => [row.table_name, row]));
  const tableGrantsVerified =
    tables.every((name) => privilegesMatch(privilegeByTable.get(name) || { table_name: name })) &&
    privilegeRows.length === tables.length;

  const browserGrants = await query(DIAGNOSTIC_SQL.browserGrants, [tables]);
  const browserGrantsVerified = (browserGrants?.rows || []).length === 0;

  const deleteExecute = await query(DIAGNOSTIC_SQL.deleteExecute, []);
  const deleteExecuteVerified = asBool(deleteExecute?.rows?.[0]?.can_execute) === false;

  const grantsVerified = tableGrantsVerified && browserGrantsVerified && deleteExecuteVerified;
  const rlsOk = rlsVerified && policiesVerified;
  if (!rlsOk) return { ok: false, reason: 'rls' };
  if (!grantsVerified) return { ok: false, reason: 'grants' };

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
}
