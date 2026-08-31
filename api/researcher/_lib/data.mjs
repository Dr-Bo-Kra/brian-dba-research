/**
 * Approved researcher-read DTOs. Fixtures are test-only. Production uses
 * parameterised SQL through a server-side query adapter — never the service role
 * unless a later review proves there is no safer option.
 */
import { LEDGER_FIELDS } from './constants.mjs';
import { pickLedger } from './authorize.mjs';
import { SQL } from './db.mjs';

export const DOMAIN_LABELS = Object.freeze({
  psychometric: 'Psychometric indicators',
  social: 'Social capital',
  behavioral: 'Behavioral economics',
  readiness: 'Organizational readiness',
  inclusiveDecision: 'Inclusive decision-making',
});

export const DOMAIN_ORDER = [
  'psychometric',
  'social',
  'behavioral',
  'readiness',
  'inclusiveDecision',
];

export const ITEM_ORDER = [
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'D11',
  'D12',
  'D13',
  'D14',
  'D15',
  'E16',
  'E17',
  'E18',
  'E19',
  'E20',
  'F21',
  'F22',
  'F23',
  'F24',
  'F25',
];

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
  if (filters.q && !String(dto.participant_reference || '').toLowerCase().includes(filters.q)) {
    return false;
  }
  return true;
}

function aggregateDomains(rows) {
  const byId = new Map();
  for (const row of rows) {
    const domains = row.assessment?.domains || [];
    for (const domain of domains) {
      if (!DOMAIN_ORDER.includes(domain.id)) continue;
      const current = byId.get(domain.id) || {
        id: domain.id,
        label: domain.label || domain.id,
        scores: [],
      };
      const score = Number(domain.score);
      if (Number.isFinite(score)) current.scores.push(score);
      byId.set(domain.id, current);
    }
  }
  return DOMAIN_ORDER.map((id) => {
    const current = byId.get(id);
    if (!current) return { id, label: id, score: null, n: 0 };
    const n = current.scores.length;
    return {
      id,
      label: current.label,
      score: n ? current.scores.reduce((a, b) => a + b, 0) / n : null,
      n,
    };
  }).filter((row) => row.n > 0);
}

function aggregateItems(rows) {
  const counts = Object.fromEntries(ITEM_ORDER.map((id) => [id, [0, 0, 0, 0, 0, 0, 0]]));
  let any = false;
  for (const row of rows) {
    const likert = row.responses?.likert || row.likert || {};
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
    return {
      id,
      label: DOMAIN_LABELS[id],
      score: Number(row.score),
      n: Number(row.n) || 0,
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

function summarize(rows) {
  const ledgers = rows.map(pickLedger).filter(Boolean);
  const orientations = ledgers
    .map((row) => Number(row.orientation))
    .filter((value) => Number.isFinite(value));
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const trendMap = new Map();
  ledgers.forEach((row) => {
    const day = String(row.accepted_at || '').slice(0, 10);
    if (!day) return;
    trendMap.set(day, (trendMap.get(day) || 0) + 1);
  });
  return {
    total: ledgers.length,
    last_24h: ledgers.filter((row) => Date.parse(row.accepted_at) >= dayAgo).length,
    mean_orientation: orientations.length
      ? orientations.reduce((a, b) => a + b, 0) / orientations.length
      : null,
    last_intake: ledgers.map((row) => row.accepted_at).filter(Boolean).sort().at(-1) || null,
    trend: [...trendMap.entries()].sort().map(([day, count]) => ({ day, count })),
    domains: aggregateDomains(rows),
    items: aggregateItems(rows),
    retention: {
      legal_hold: ledgers.filter((row) => row.legal_hold).length,
      anonymised: 0,
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
      return row ? slimLedger(row) : null;
    },
    async getQualitative(reference) {
      const row = records.find((item) => item.client_record_id === reference && !item.anonymised_at);
      return row ? qualitativeDto(row) : null;
    },
    async exportRows(filters, maxRows) {
      const rows = records.filter((row) => matchesFilters(row, filters));
      if (rows.length > maxRows) return { ok: false, error: 'invalid_request' };
      return { ok: true, rows: rows.map((row) => slimLedger(row)) };
    },
    async deleteByReference(reference) {
      const idx = records.findIndex((row) => row.client_record_id === reference);
      const held = idx >= 0 && records[idx].legal_hold;
      const deleted = idx >= 0 && !held;
      if (deleted) records.splice(idx, 1);
      return { legal_hold: Boolean(held), deleted };
    },
    async lookupResearcher() {
      return null;
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

  return {
    backend: 'database',
    async summary(filters) {
      const params = filterParams(filters).slice(0, 5);
      const result = await query(SQL.summary, params);
      const row = result?.rows?.[0] || {};
      const trend = await query(SQL.trend, params);
      const domains = await query(SQL.domainAggregates, params);
      const items = await query(SQL.itemAggregates, params);
      return {
        total: Number(row.total) || 0,
        last_24h: Number(row.last_24h) || 0,
        mean_orientation: row.mean_orientation == null ? null : Number(row.mean_orientation),
        last_intake: row.last_intake || null,
        trend: (trend?.rows || []).map((item) => ({ day: item.day, count: Number(item.count) || 0 })),
        domains: mapDomainAggregates(domains?.rows || []),
        items: mapItemAggregates(items?.rows || []),
        retention: {
          legal_hold: Number(row.legal_hold) || 0,
          anonymised: Number(row.anonymised) || 0,
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
      const result = await query(SQL.getByReference, [reference]);
      const row = result?.rows?.[0];
      return row
        ? slimLedger({
            client_record_id: row.client_record_id,
            created_at: row.created_at,
            region: row.region,
            role: row.role,
            experience: row.experience,
            orientation: row.orientation,
            legal_hold: row.legal_hold,
            anonymised_at: row.anonymised_at,
          })
        : null;
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
    async exportRows(filters, maxRows) {
      const result = await query(SQL.exportRows, [...filterParams(filters), maxRows + 1]);
      const rows = result?.rows || [];
      if (rows.length > maxRows) return { ok: false, error: 'invalid_request' };
      return {
        ok: true,
        rows: rows.map((row) =>
          slimLedger({
            client_record_id: row.participant_reference,
            created_at: row.accepted_at,
            region: row.region,
            role: row.role,
            experience: row.experience,
            orientation: row.orientation,
          })
        ),
      };
    },
    async deleteByReference(reference) {
      await query(SQL.deleteByReference, [reference]);
      return { legal_hold: false, deleted: false };
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
    async exportRows() {
      return { ok: false, error: 'unavailable' };
    },
    async deleteByReference() {
      return { legal_hold: false, deleted: false };
    },
    async lookupResearcher() {
      return null;
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
