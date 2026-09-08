/**
 * Approved researcher-read DTOs. Fixtures are test-only. Production uses
 * parameterised SQL through a server-side query adapter — never the service role
 * unless a later review proves there is no safer option.
 */
import { DOMAIN_ORDER, ITEM_ORDER, LEDGER_FIELDS } from './constants.mjs';
import { pickLedger } from './authorize.mjs';
import { SQL } from './db.mjs';
import {
  aggregateProfileComposition,
  aggregateSegments,
  binScoresToCounts,
  pickCodedProfile,
  sampleSd,
} from './profile.mjs';

export { DOMAIN_ORDER, ITEM_ORDER };

export const DOMAIN_LABELS = Object.freeze({
  psychometric: 'Psychometric indicators',
  social: 'Social capital',
  behavioral: 'Behavioral economics',
  readiness: 'Organizational readiness',
  inclusiveDecision: 'Inclusive decision-making',
});

function slimLedger(record) {
  const dto = pickLedger(record);
  if (!dto) return null;
  const slim = {};
  for (const field of LEDGER_FIELDS) slim[field] = dto[field];
  return slim;
}

function qualitativeDto(record) {
  const raw = record.qualitative || record.responses?.qualitative || {};
  const openResponses =
    raw.openResponses && typeof raw.openResponses === 'object' ? raw.openResponses : {};
  const safeOpens = {};
  for (const [key, value] of Object.entries(openResponses)) {
    if (typeof value === 'string' || typeof value === 'number') safeOpens[key] = String(value);
  }
  return {
    participant_reference: record.participant_reference || record.client_record_id,
    qualitative: {
      openResponses: safeOpens,
      ...(typeof raw.roleDescription === 'string' ? { roleDescription: raw.roleDescription } : {}),
    },
  };
}

function matchesFilters(record, filters) {
  const dto = pickLedger(record);
  if (!dto || record.anonymised_at) return false;
  const day = String(dto.accepted_at || '').slice(0, 10);
  if (filters.from && day && day < filters.from) return false;
  if (filters.to && day && day > filters.to) return false;
  if (filters.region && dto.region !== filters.region) return false;
  if (filters.role && dto.role !== filters.role) return false;
  if (filters.experience && dto.experience !== filters.experience) return false;
  if (filters.reference && dto.participant_reference !== filters.reference) return false;
  if (
    !filters.reference &&
    filters.q &&
    !String(dto.participant_reference || '').toLowerCase().includes(String(filters.q).toLowerCase())
  ) {
    return false;
  }
  return true;
}

function addMonthsIso(iso, months) {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return null;
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function isRetentionDue(record, policy) {
  if (!policy || record.anonymised_at) return false;
  const accepted = record.created_at || record.accepted_at || record.consented_at;
  if (!accepted) return false;
  if (policy.basis === 'study_completion') {
    if (!policy.reviewOpen || !policy.studyCompletionDate) return false;
    return String(accepted).slice(0, 10) <= policy.studyCompletionDate;
  }
  const dueAt = addMonthsIso(accepted, policy.retentionMonths || 12);
  return Boolean(dueAt && Date.now() >= Date.parse(dueAt));
}

function retentionDueRows(records, policy, maxRows) {
  return records
    .filter((row) => isRetentionDue(row, policy))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(0, maxRows)
    .map((row) => ({
      participant_reference: row.client_record_id || row.participant_reference,
      accepted_at: row.created_at || row.accepted_at || null,
      legal_hold: Boolean(row.legal_hold),
    }));
}

function aggregateDomains(rows) {
  const byId = new Map();
  for (const row of rows) {
    const domains = row.assessment?.domains || [];
    for (const domain of domains) {
      if (!DOMAIN_ORDER.includes(domain.id)) continue;
      const current = byId.get(domain.id) || {
        id: domain.id,
        label: domain.label || DOMAIN_LABELS[domain.id] || domain.id,
        scores: [],
      };
      const score = Number(domain.score);
      if (Number.isFinite(score)) current.scores.push(score);
      byId.set(domain.id, current);
    }
  }
  return DOMAIN_ORDER.map((id) => {
    const current = byId.get(id);
    if (!current) return { id, label: DOMAIN_LABELS[id] || id, score: null, n: 0, sd: null, counts: [0, 0, 0, 0, 0, 0, 0] };
    const n = current.scores.length;
    return {
      id,
      label: current.label || DOMAIN_LABELS[id] || id,
      score: n ? current.scores.reduce((a, b) => a + b, 0) / n : null,
      n,
      sd: sampleSd(current.scores),
      counts: binScoresToCounts(current.scores),
    };
  }).filter((row) => row.n > 0);
}

function quantitativeDetailDto(record) {
  const ledger = slimLedger(record);
  if (!ledger) return null;
  const profile = pickCodedProfile(record.profile || record.responses?.quantitative?.demographics);
  const domains = (Array.isArray(record.assessment?.domains) ? record.assessment.domains : [])
    .filter((domain) => DOMAIN_ORDER.includes(domain.id))
    .map((domain) => ({
      id: domain.id,
      label: DOMAIN_LABELS[domain.id] || domain.label || domain.id,
      score: Number.isFinite(Number(domain.score)) ? Number(domain.score) : null,
    }));
  const rawLikert = record.responses?.quantitative?.likert || {};
  const likert = {};
  for (const id of ITEM_ORDER) {
    const value = Number(rawLikert[id]);
    if (Number.isInteger(value) && value >= 1 && value <= 7) likert[id] = value;
  }
  return {
    ...ledger,
    profile,
    domains,
    likert,
  };
}

function quantitativeExportDto(record) {
  const detail = quantitativeDetailDto(record);
  if (!detail) return null;
  const row = {
    participant_reference: detail.participant_reference,
    accepted_at: detail.accepted_at,
    region: detail.region,
    role: detail.role,
    experience: detail.experience,
    gender: detail.profile?.gender || null,
    age: detail.profile?.age || null,
    education: detail.profile?.education || null,
    institutionType: detail.profile?.institutionType || null,
    yearsFinancialServices: detail.profile?.yearsFinancialServices || null,
    areaOperation: detail.profile?.areaOperation || null,
    involvement: detail.profile?.involvement || null,
    usesAltIndicators: detail.profile?.usesAltIndicators || null,
    orientation: detail.orientation,
  };
  for (const id of DOMAIN_ORDER) {
    const domain = detail.domains.find((entry) => entry.id === id);
    row[`domain_${id}`] = domain?.score ?? null;
  }
  for (const id of ITEM_ORDER) {
    row[id] = detail.likert[id] ?? null;
  }
  return row;
}

function aggregateItems(rows) {
  const counts = Object.fromEntries(ITEM_ORDER.map((id) => [id, [0, 0, 0, 0, 0, 0, 0]]));
  let any = false;
  for (const row of rows) {
    const likert = row.responses?.quantitative?.likert || {};
    for (const id of ITEM_ORDER) {
      const value = Number(likert[id]);
      if (Number.isInteger(value) && value >= 1 && value <= 7) {
        counts[id][value - 1] += 1;
        any = true;
      }
    }
  }
  if (!any) return [];
  return ITEM_ORDER.map((id) => ({ id, counts: counts[id] }));
}

export function mapDomainAggregates(rows = []) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return DOMAIN_ORDER.filter((id) => byId.has(id)).map((id) => {
    const row = byId.get(id);
    const n = Number(row.n) || 0;
    const counts = Array.isArray(row.counts)
      ? row.counts.map((value) => Number(value) || 0)
      : [
          Number(row.c1) || 0,
          Number(row.c2) || 0,
          Number(row.c3) || 0,
          Number(row.c4) || 0,
          Number(row.c5) || 0,
          Number(row.c6) || 0,
          Number(row.c7) || 0,
        ];
    return {
      id,
      label: DOMAIN_LABELS[id],
      score: row.score == null ? null : Number(row.score),
      n,
      sd: row.sd == null || !Number.isFinite(Number(row.sd)) ? null : Number(row.sd),
      counts: counts.length === 7 ? counts : [0, 0, 0, 0, 0, 0, 0],
    };
  });
}

export function mapItemAggregates(rows = []) {
  if (!rows.length) return [];
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  return ITEM_ORDER.map((id) => {
    const row = byId[id];
    return {
      id,
      counts: row
        ? [row.c1, row.c2, row.c3, row.c4, row.c5, row.c6, row.c7].map((value) => Number(value) || 0)
        : [0, 0, 0, 0, 0, 0, 0],
    };
  });
}

export function mapProfileComposition(rows = []) {
  const tallies = Object.fromEntries(
    [
      'countryRegion',
      'position',
      'yearsLending',
      'gender',
      'age',
      'education',
      'institutionType',
      'yearsFinancialServices',
      'areaOperation',
      'involvement',
      'usesAltIndicators',
    ].map((dim) => [dim, []])
  );
  for (const row of rows) {
    const dim = String(row.dim || row.dimension || '');
    if (!tallies[dim]) continue;
    const key = String(row.key || '').trim() || 'unknown';
    tallies[dim].push({ key, n: Number(row.n) || 0 });
  }
  for (const dim of Object.keys(tallies)) {
    tallies[dim].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  }
  return tallies;
}

function summarize(rows) {
  const ledgers = rows.map(pickLedger).filter(Boolean);
  const orientations = ledgers
    .map((row) => Number(row.orientation))
    .filter((value) => Number.isFinite(value));
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const trendMap = new Map();
  ledgers.forEach((row) => {
    const day = String(row.accepted_at || '').slice(0, 10);
    if (!day) return;
    trendMap.set(day, (trendMap.get(day) || 0) + 1);
  });
  return {
    total: ledgers.length,
    last_24h: ledgers.filter((row) => Date.parse(row.accepted_at) >= dayAgo).length,
    last_7d: ledgers.filter((row) => Date.parse(row.accepted_at) >= weekAgo).length,
    mean_orientation: orientations.length
      ? orientations.reduce((a, b) => a + b, 0) / orientations.length
      : null,
    last_intake: ledgers.map((row) => row.accepted_at).filter(Boolean).sort().at(-1) || null,
    trend: [...trendMap.entries()].sort().map(([day, count]) => ({ day, count })),
    domains: aggregateDomains(rows),
    items: aggregateItems(rows),
    profile: aggregateProfileComposition(rows),
    retention: {
      legal_hold: ledgers.filter((row) => row.legal_hold).length,
      anonymised: 0,
      due_for_review: 0,
      auto_delete: false,
    },
  };
}

export function createFixtureResearchStore(records) {
  return {
    backend: 'fixture',
    async summary(filters) {
      return summarize(records.filter((row) => matchesFilters(row, filters)));
    },
    async list(filters) {
      const rows = records.filter((row) => matchesFilters(row, filters)).map(slimLedger);
      return { records: rows.slice(0, filters.limit), next_cursor: null };
    },
    async getByReference(reference) {
      const row = records.find((item) => item.client_record_id === reference && !item.anonymised_at);
      return row ? quantitativeDetailDto(row) : null;
    },
    async getQualitative(reference) {
      const row = records.find((item) => item.client_record_id === reference && !item.anonymised_at);
      return row ? qualitativeDto(row) : null;
    },
    async segments(filters, dimension, measure) {
      const rows = records.filter((row) => matchesFilters(row, filters));
      return aggregateSegments(rows, dimension, measure);
    },
    async exportRows(filters, maxRows) {
      const rows = records.filter((row) => matchesFilters(row, filters));
      if (rows.length > maxRows) return { ok: false, error: 'invalid_request' };
      return { ok: true, rows: rows.map((row) => quantitativeExportDto(row)).filter(Boolean) };
    },
    async deleteByReference(reference) {
      const idx = records.findIndex((row) => row.client_record_id === reference);
      const held = idx >= 0 && records[idx].legal_hold;
      const deleted = idx >= 0 && !held;
      if (deleted) records.splice(idx, 1);
      return { legal_hold: Boolean(held), deleted };
    },
    async listRetentionDue(policy, maxRows = 100) {
      return retentionDueRows(records, policy, maxRows);
    },
    async countRetentionDue(policy) {
      return retentionDueRows(records, policy, Number.MAX_SAFE_INTEGER).length;
    },
    async lookupResearcher() {
      return null;
    },
    async countActiveResearchers() {
      return 0;
    },
  };
}

export function createDatabaseResearchStore(query) {
  const filterParams = (filters) => [
    filters.from,
    filters.to,
    filters.region,
    filters.role,
    filters.experience,
    filters.q ? `%${filters.q}%` : null,
  ];

  const retentionParams = (policy) => [
    policy.basis,
    policy.retentionMonths,
    policy.basis === 'study_completion' ? Boolean(policy.reviewOpen) : false,
    policy.studyCompletionDate || null,
  ];

  return {
    backend: 'database',
    async summary(filters) {
      const params = filterParams(filters).slice(0, 5);
      const result = await query(SQL.summary, params);
      const row = result?.rows?.[0] || {};
      const trend = await query(SQL.trend, params);
      const domains = await query(SQL.domainAggregates, params);
      const items = await query(SQL.itemAggregates, params);
      const profile = await query(SQL.profileComposition, params);
      return {
        total: Number(row.total) || 0,
        last_24h: Number(row.last_24h) || 0,
        last_7d: Number(row.last_7d) || 0,
        mean_orientation: row.mean_orientation == null ? null : Number(row.mean_orientation),
        last_intake: row.last_intake || null,
        trend: (trend?.rows || []).map((item) => ({ day: item.day, count: Number(item.count) || 0 })),
        domains: mapDomainAggregates(domains?.rows || []),
        items: mapItemAggregates(items?.rows || []),
        profile: mapProfileComposition(profile?.rows || []),
        retention: {
          legal_hold: Number(row.legal_hold) || 0,
          anonymised: Number(row.anonymised) || 0,
          due_for_review: 0,
          auto_delete: false,
        },
      };
    },
    async list(filters) {
      const result = await query(SQL.listResponses, [...filterParams(filters), filters.limit]);
      return {
        records: (result?.rows || []).map((row) =>
          slimLedger({
            client_record_id: row.client_record_id,
            created_at: row.created_at,
            region: row.region,
            role: row.role,
            experience: row.experience,
            orientation: row.orientation,
            legal_hold: row.legal_hold,
            anonymised_at: row.anonymised_at,
          })
        ),
        next_cursor: null,
      };
    },
    async getByReference(reference) {
      const result = await query(SQL.getQuantitativeByReference, [reference]);
      const row = result?.rows?.[0];
      if (!row) return null;
      return quantitativeDetailDto({
        client_record_id: row.client_record_id,
        created_at: row.created_at,
        region: row.region,
        role: row.role,
        experience: row.experience,
        orientation: row.orientation,
        legal_hold: row.legal_hold,
        anonymised_at: row.anonymised_at,
        profile: row.profile || {},
        assessment: {
          domains: Array.isArray(row.domains) ? row.domains : [],
          overall: { score: row.orientation },
        },
        responses: {
          quantitative: {
            likert: row.likert && typeof row.likert === 'object' ? row.likert : {},
          },
        },
      });
    },
    async getQualitative(reference) {
      const result = await query(SQL.getQualitativeByReference, [reference]);
      const row = result?.rows?.[0];
      if (!row) return null;
      return qualitativeDto({
        client_record_id: row.client_record_id,
        qualitative: row.qualitative || {},
      });
    },
    async segments(filters, dimension, measure) {
      const params = [...filterParams(filters).slice(0, 5), dimension];
      let result;
      if (measure.type === 'overall') {
        result = await query(SQL.segmentOverall, params);
      } else if (measure.type === 'domain') {
        result = await query(SQL.segmentDomain, [...params, measure.id]);
      } else {
        result = await query(SQL.segmentItem, [...params, measure.id]);
      }
      const segments = (result?.rows || []).map((row) => ({
        key: String(row.key || 'unknown'),
        n: Number(row.n) || 0,
        mean: row.mean == null ? null : Number(row.mean),
        sd: row.sd == null || !Number.isFinite(Number(row.sd)) ? null : Number(row.sd),
        sdKind: Number(row.n) > 1 ? 'sample' : Number(row.n) === 1 ? 'population' : null,
        counts: [
          Number(row.c1) || 0,
          Number(row.c2) || 0,
          Number(row.c3) || 0,
          Number(row.c4) || 0,
          Number(row.c5) || 0,
          Number(row.c6) || 0,
          Number(row.c7) || 0,
        ],
      }));
      return {
        ok: true,
        dimension,
        measure,
        segments,
        descriptive_only: true,
      };
    },
    async exportRows(filters, maxRows) {
      const result = await query(SQL.exportQuantitativeRows, [
        ...filterParams(filters),
        filters.reference || null,
        maxRows + 1,
      ]);
      const rows = result?.rows || [];
      if (rows.length > maxRows) return { ok: false, error: 'invalid_request' };
      return {
        ok: true,
        rows: rows.map((row) =>
          quantitativeExportDto({
            client_record_id: row.participant_reference,
            created_at: row.accepted_at,
            region: row.region,
            role: row.role,
            experience: row.experience,
            orientation: row.orientation,
            profile: row.profile || {},
            assessment: {
              domains: Array.isArray(row.domains) ? row.domains : [],
              overall: { score: row.orientation },
            },
            responses: {
              quantitative: {
                likert: row.likert && typeof row.likert === 'object' ? row.likert : {},
              },
            },
          })
        ),
      };
    },
    async deleteByReference(reference) {
      const result = await query(SQL.deleteByReference, [reference]);
      const row = result?.rows?.[0] || {};
      return {
        legal_hold: Boolean(row.legal_hold),
        deleted: Boolean(row.deleted),
      };
    },
    async listRetentionDue(policy, maxRows = 100) {
      if (policy.basis === 'study_completion' && !policy.reviewOpen) return [];
      const result = await query(SQL.retentionDue, [...retentionParams(policy), maxRows]);
      return (result?.rows || []).map((row) => ({
        participant_reference: row.participant_reference,
        accepted_at: row.accepted_at || null,
        legal_hold: Boolean(row.legal_hold),
      }));
    },
    async countRetentionDue(policy) {
      if (policy.basis === 'study_completion' && !policy.reviewOpen) return 0;
      const result = await query(SQL.retentionDueCount, retentionParams(policy));
      return Number(result?.rows?.[0]?.n) || 0;
    },
    async lookupResearcher(subject) {
      const result = await query(SQL.lookupResearcher, [subject]);
      const row = result?.rows?.[0];
      if (!row) return null;
      return {
        role: row.role,
        mfaRequired: row.mfa_required !== false,
        revokedAt: row.revoked_at || null,
        disabledAt: row.disabled_at || null,
      };
    },
    async countActiveResearchers() {
      const result = await query(SQL.countActiveResearchers, []);
      return Number(result?.rows?.[0]?.n) || 0;
    },
  };
}

export function createUnavailableResearchStore() {
  return {
    backend: 'unavailable',
    async summary() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
    async list() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
    async getByReference() {
      return null;
    },
    async getQualitative() {
      return null;
    },
    async segments() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
    async exportRows() {
      return { ok: false, error: 'unavailable' };
    },
    async deleteByReference() {
      return { legal_hold: false, deleted: false };
    },
    async listRetentionDue() {
      return [];
    },
    async countRetentionDue() {
      return 0;
    },
    async lookupResearcher() {
      return null;
    },
    async countActiveResearchers() {
      return 0;
    },
  };
}

export function resolveResearchStore(config, overrides = {}) {
  if (overrides.allowMemoryStores === true) {
    return createFixtureResearchStore(Array.isArray(overrides.records) ? overrides.records : []);
  }
  if (config.sessionStore === 'database' && overrides.query && config.dataReady) {
    return createDatabaseResearchStore(overrides.query);
  }
  return createUnavailableResearchStore();
}
