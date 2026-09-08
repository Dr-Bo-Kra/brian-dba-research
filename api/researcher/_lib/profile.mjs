/**
 * Coded profile dimensions for researcher aggregates / segments / export.
 * Mirrors submission PROFILE_KEYS — codes only, never free-text.
 */

import {
  DOMAIN_ORDER,
  EXPERIENCE_CODES,
  ITEM_ORDER,
  REGION_CODES,
  ROLE_CODES,
} from './constants.mjs';

export const PROFILE_DIMENSIONS = Object.freeze([
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
]);

/** Ledger / filter aliases → profile JSON keys */
export const FILTER_TO_PROFILE = Object.freeze({
  region: 'countryRegion',
  role: 'position',
  experience: 'yearsLending',
});

export const PROFILE_OPTION_CODES = Object.freeze({
  countryRegion: REGION_CODES,
  position: ROLE_CODES,
  yearsLending: EXPERIENCE_CODES,
  gender: Object.freeze(['male', 'female', 'prefer-not']),
  age: Object.freeze(['20-29', '30-39', '40-49', '50-59', '60plus']),
  education: Object.freeze([
    'diploma',
    'bachelors',
    'masters',
    'doctorate',
    'professional',
    'other',
  ]),
  institutionType: Object.freeze([
    'commercial-bank',
    'mfi',
    'cooperative',
    'fintech',
    'digital-bank',
    'dfi',
    'other',
  ]),
  yearsFinancialServices: EXPERIENCE_CODES,
  areaOperation: Object.freeze(['urban', 'rural', 'both']),
  involvement: Object.freeze([
    'assess',
    'recommend',
    'approve-reject',
    'supervise',
    'policies',
    'support',
    'other',
  ]),
  usesAltIndicators: Object.freeze(['yes', 'no', 'implementing', 'not-sure']),
});

export const PROFILE_DIMENSION_LABELS = Object.freeze({
  countryRegion: 'Geography',
  position: 'Role',
  yearsLending: 'Lending experience',
  gender: 'Gender',
  age: 'Age',
  education: 'Education',
  institutionType: 'Institution type',
  yearsFinancialServices: 'Financial services experience',
  areaOperation: 'Area of operation',
  involvement: 'Involvement',
  usesAltIndicators: 'Uses alternative indicators',
});

export const SEGMENT_DIMENSIONS = PROFILE_DIMENSIONS;

const DOMAIN_ORDER_SET = new Set(DOMAIN_ORDER);
const ITEM_ORDER_SET = new Set(ITEM_ORDER);

/**
 * @param {object|null|undefined} profile
 * @returns {Record<string, string|null>}
 */
export function pickCodedProfile(profile) {
  const src = profile && typeof profile === 'object' ? profile : {};
  const out = {};
  for (const key of PROFILE_DIMENSIONS) {
    const value = src[key];
    const allowed = PROFILE_OPTION_CODES[key];
    out[key] = typeof value === 'string' && allowed.includes(value) ? value : null;
  }
  return out;
}

/**
 * @param {object[]} rows - fixture / raw assessment rows
 * @returns {Record<string, { key: string, n: number }[]>}
 */
export function aggregateProfileComposition(rows) {
  const tallies = Object.fromEntries(PROFILE_DIMENSIONS.map((dim) => [dim, new Map()]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const profile = pickCodedProfile(row.profile || row.responses?.quantitative?.demographics);
    for (const dim of PROFILE_DIMENSIONS) {
      const key = profile[dim] || 'unknown';
      const map = tallies[dim];
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return Object.fromEntries(
    PROFILE_DIMENSIONS.map((dim) => [
      dim,
      [...tallies[dim].entries()]
        .map(([key, n]) => ({ key, n }))
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
    ])
  );
}

/**
 * Count responses in the last N calendar days from trend day buckets (UTC date strings).
 * Includes today through (days - 1) days back.
 * @param {{ day?: string, count?: number }[]} trend
 * @param {number} days
 * @param {number} [nowMs]
 */
export function countRecentFromTrend(trend, days, nowMs = Date.now()) {
  const cutoff = new Date(nowMs);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (Math.max(1, Number(days) || 1) - 1));
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  let total = 0;
  for (const row of Array.isArray(trend) ? trend : []) {
    const day = String(row?.day || '');
    if (day && day >= cutoffDay) total += Number(row.count) || 0;
  }
  return total;
}

/**
 * Sample SD for a numeric array (n > 1). Descriptive only.
 * @param {number[]} values
 * @returns {number|null}
 */
export function sampleSd(values) {
  const nums = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (nums.length <= 1) return nums.length === 1 ? 0 : null;
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  let sumSq = 0;
  for (const value of nums) {
    const delta = value - mean;
    sumSq += delta * delta;
  }
  return Math.sqrt(sumSq / (nums.length - 1));
}

/**
 * Bin continuous 1–7 scores into a Likert-style histogram by rounded value.
 * @param {number[]} scores
 * @returns {number[]}
 */
export function binScoresToCounts(scores) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const value of Array.isArray(scores) ? scores : []) {
    if (!Number.isFinite(value)) continue;
    const idx = Math.min(6, Math.max(0, Math.round(value) - 1));
    counts[idx] += 1;
  }
  return counts;
}

/**
 * Parse measure query: overall | domain:<id> | item:<id>
 * @param {string} raw
 */
export function parseSegmentMeasure(raw) {
  const value = String(raw || 'overall').trim();
  if (!value || value === 'overall') return { ok: true, type: 'overall', id: null };
  const domainMatch = /^domain:(.+)$/i.exec(value);
  if (domainMatch) {
    const id = domainMatch[1];
    if (!DOMAIN_ORDER_SET.has(id)) return { ok: false, error: 'invalid_request' };
    return { ok: true, type: 'domain', id };
  }
  const itemMatch = /^item:(.+)$/i.exec(value);
  if (itemMatch) {
    const id = itemMatch[1];
    if (!ITEM_ORDER_SET.has(id)) return { ok: false, error: 'invalid_request' };
    return { ok: true, type: 'item', id };
  }
  return { ok: false, error: 'invalid_request' };
}

/**
 * Aggregate segment stats from fixture rows (descriptive only).
 * @param {object[]} rows
 * @param {string} dimension
 * @param {{ type: string, id: string|null }} measure
 */
export function aggregateSegments(rows, dimension, measure) {
  if (!SEGMENT_DIMENSIONS.includes(dimension)) {
    return { ok: false, error: 'invalid_request' };
  }
  const buckets = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const profile = pickCodedProfile(row.profile || row.responses?.quantitative?.demographics);
    const key = profile[dimension] || 'unknown';
    const bucket = buckets.get(key) || { key, values: [], counts: [0, 0, 0, 0, 0, 0, 0] };
    let value = null;
    if (measure.type === 'overall') {
      value = Number(row.orientation ?? row.assessment?.overall?.score);
    } else if (measure.type === 'domain') {
      const domain = (row.assessment?.domains || []).find((entry) => entry.id === measure.id);
      value = domain == null ? null : Number(domain.score);
    } else if (measure.type === 'item') {
      value = Number(row.responses?.quantitative?.likert?.[measure.id]);
      if (Number.isInteger(value) && value >= 1 && value <= 7) {
        bucket.counts[value - 1] += 1;
      } else {
        value = null;
      }
    }
    if (value != null && Number.isFinite(value)) bucket.values.push(value);
    buckets.set(key, bucket);
  }

  const segments = [...buckets.values()]
    .map((bucket) => {
      const n = bucket.values.length;
      const mean = n ? bucket.values.reduce((sum, value) => sum + value, 0) / n : null;
      const sd = sampleSd(bucket.values);
      const counts =
        measure.type === 'item' ? bucket.counts : n ? binScoresToCounts(bucket.values) : [0, 0, 0, 0, 0, 0, 0];
      return {
        key: bucket.key,
        n,
        mean,
        sd,
        sdKind: n > 1 ? 'sample' : n === 1 ? 'population' : null,
        counts,
      };
    })
    .filter((row) => row.n > 0)
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));

  return {
    ok: true,
    dimension,
    measure,
    segments,
    descriptive_only: true,
  };
}
