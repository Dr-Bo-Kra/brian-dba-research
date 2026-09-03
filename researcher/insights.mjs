/**
 * Plain-English, strictly descriptive insight copy for the researcher dashboard.
 * Every statement must be derivable from existing summary aggregates (domain means,
 * item means / sample SDs). No causal, inferential, or evaluative claims.
 */

import { rankItemHighlights, statsFromCounts } from './item-analysis.mjs';

/** Scores within this gap are treated as similar — do not call one uniquely "highest". */
export const SIMILARITY_THRESHOLD = 0.15;

/** Prefer items with at least this many ratings for consistency / variation claims. */
export const MIN_N_FOR_SPREAD = 5;

export const BANNED_INSIGHT_WORDS = Object.freeze([
  'significant',
  'causes',
  'proves',
  'representative',
  'effective',
  'better',
  'worse',
  'p-value',
  'causal',
  'causation',
  'prove',
  'proving',
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function bannedWordsInText(text) {
  const hay = String(text || '').toLowerCase();
  return BANNED_INSIGHT_WORDS.filter((word) => {
    const needle = String(word).toLowerCase();
    if (needle.includes('-') || needle.includes(' ')) return hay.includes(needle);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(hay);
  });
}

/**
 * @param {string|string[]} texts
 */
export function assertDescriptiveInsightCopy(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  for (const text of list) {
    const hits = bannedWordsInText(text);
    if (hits.length) {
      throw new Error(`Insight copy uses banned wording (${hits.join(', ')}): ${text}`);
    }
  }
}

/**
 * @param {string[]} names
 * @returns {string}
 */
export function formatNameList(names) {
  const clean = (Array.isArray(names) ? names : []).map((name) => String(name || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

/**
 * @param {{ id?: string, label?: string, score?: number|null, n?: number }[]} domains
 * @returns {{ id: string, label: string, score: number, n: number }[]}
 */
export function rankDomainsByMean(domains) {
  return (Array.isArray(domains) ? domains : [])
    .map((row) => ({
      id: String(row?.id || ''),
      label: String(row?.label || row?.id || '').trim(),
      score: row?.score == null || !Number.isFinite(Number(row.score)) ? null : Number(row.score),
      n: Number(row?.n) || 0,
    }))
    .filter((row) => row.id && row.score != null)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * Relative plain-English label for a domain score versus the current set.
 * Tiny gaps (≤ SIMILARITY_THRESHOLD) are not treated as a unique ranking.
 *
 * @param {number|null|undefined} score
 * @param {{ score?: number|null }[]} domains
 * @returns {string}
 */
export function relativeDomainLabel(score, domains) {
  if (score == null || !Number.isFinite(Number(score))) return '';
  const scored = rankDomainsByMean(domains);
  if (!scored.length) return '';
  const value = Number(score);
  const scores = scored.map((row) => row.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const mean = scores.reduce((sum, entry) => sum + entry, 0) / scores.length;
  const spread = max - min;

  if (spread <= SIMILARITY_THRESHOLD) {
    return 'Close to the overall pattern';
  }
  if (max - value <= SIMILARITY_THRESHOLD) {
    const nearTop = scored.filter((row) => max - row.score <= SIMILARITY_THRESHOLD);
    return nearTop.length > 1 ? 'Among the highest currently' : 'Highest currently';
  }
  if (value - min <= SIMILARITY_THRESHOLD) {
    return 'Slightly lower';
  }
  if (Math.abs(value - mean) <= SIMILARITY_THRESHOLD) {
    return 'Close to the overall pattern';
  }
  if (value < mean) return 'Slightly lower';
  return 'Close to the overall pattern';
}

/**
 * @param {{ id: string, counts?: number[] }[]} items
 * @param {Record<string, string>} labels
 * @param {number} [minN]
 */
function scoredItems(items, labels, minN = MIN_N_FOR_SPREAD) {
  const ranked = rankItemHighlights(items, { labels, highlightCount: 25 });
  const all = ranked.all.filter((row) => row.sd != null && Number.isFinite(row.sd));
  const eligible = all.filter((row) => row.n >= minN);
  if (eligible.length >= 2) return eligible;
  const relaxed = all.filter((row) => row.n > 1);
  return relaxed.length >= 2 ? relaxed : all;
}

/**
 * Build a small set of descriptive insight cards from summary aggregates.
 *
 * @param {{
 *   domains?: { id?: string, label?: string, score?: number|null, n?: number }[],
 *   items?: { id: string, counts?: number[] }[],
 *   total?: number
 * }} summary
 * @param {{ labels?: Record<string, string>, maxInsights?: number }} [options]
 * @returns {{ id: string, headline: string, detail: string, source: string }[]}
 */
export function buildStudyInsights(summary, options = {}) {
  const labels = options.labels || {};
  const maxInsights = Math.max(1, Number(options.maxInsights) || 4);
  const domains = rankDomainsByMean(summary?.domains || []);
  const items = Array.isArray(summary?.items) ? summary.items : [];
  const insights = [];

  if (domains.length >= 2) {
    const max = domains[0].score;
    const min = domains[domains.length - 1].score;
    const spread = max - min;

    if (spread <= SIMILARITY_THRESHOLD) {
      insights.push({
        id: 'domains-similar',
        headline: 'The five research themes currently show similar average scores.',
        detail: `Theme averages sit within ${SIMILARITY_THRESHOLD.toFixed(2)} points of each other on the 1–7 scale.`,
        source: 'domain_means',
      });
    } else {
      const nearTop = domains.filter((row) => max - row.score <= SIMILARITY_THRESHOLD);
      const nearBottom = domains.filter((row) => row.score - min <= SIMILARITY_THRESHOLD);

      if (nearTop.length === 1) {
        insights.push({
          id: 'domain-highest',
          headline: `${nearTop[0].label} currently has the highest average score.`,
          detail: `Average ${nearTop[0].score.toFixed(2)} on the 1–7 scale (descriptive only).`,
          source: 'domain_means',
        });
      } else if (nearTop.length > 1) {
        insights.push({
          id: 'domain-highest-tie',
          headline: `${formatNameList(nearTop.map((row) => row.label))} currently have among the highest average scores.`,
          detail: `These themes are within ${SIMILARITY_THRESHOLD.toFixed(2)} points of each other at the top of the current set.`,
          source: 'domain_means',
        });
      }

      if (nearBottom.length === 1) {
        insights.push({
          id: 'domain-lowest',
          headline: `${nearBottom[0].label} currently has the lowest average score.`,
          detail: `Average ${nearBottom[0].score.toFixed(2)} on the 1–7 scale (descriptive only).`,
          source: 'domain_means',
        });
      } else if (nearBottom.length > 1) {
        insights.push({
          id: 'domain-lowest-tie',
          headline: `${formatNameList(nearBottom.map((row) => row.label))} currently have the lowest averages.`,
          detail: `These themes are within ${SIMILARITY_THRESHOLD.toFixed(2)} points of each other at the lower end of the current set.`,
          source: 'domain_means',
        });
      }
    }
  }

  const spreadItems = scoredItems(items, labels);
  if (spreadItems.length >= 2) {
    const bySdAsc = [...spreadItems].sort(
      (a, b) => a.sd - b.sd || a.id.localeCompare(b.id)
    );
    const bySdDesc = [...spreadItems].sort(
      (a, b) => b.sd - a.sd || a.id.localeCompare(b.id)
    );
    const mostConsistent = bySdAsc[0];
    const mostVariable = bySdDesc[0];
    const consistentLabel = mostConsistent.label || mostConsistent.id;
    const variableLabel = mostVariable.label || mostVariable.id;

    if (mostConsistent.id !== mostVariable.id) {
      insights.push({
        id: 'item-consistent',
        headline: `Responses to “${consistentLabel}” are among the most consistent.`,
        detail: `Lowest sample spread among questions with enough answers in the current filter (item ${mostConsistent.id}).`,
        source: 'item_sd',
      });
      insights.push({
        id: 'item-variable',
        headline: `Responses to “${variableLabel}” vary more than most other questions.`,
        detail: `Highest sample spread among questions with enough answers in the current filter (item ${mostVariable.id}).`,
        source: 'item_sd',
      });
    }
  }

  const trimmed = insights.slice(0, maxInsights);
  assertDescriptiveInsightCopy(trimmed.flatMap((row) => [row.headline, row.detail]));
  return trimmed;
}

/**
 * Compact participation line for the glance band (current page only).
 * Prefer geography count over headlining a single mode region.
 * Avoids population / representativeness language.
 *
 * @param {unknown[]} records
 * @param {[string, string][]} geography
 * @param {[string, string][]} roles
 * @returns {{ value: string, note: string, geographyCount: number, topGeography: string, topRole: string }}
 */
export function participationGlanceCopy(records, geography = [], roles = []) {
  const rows = Array.isArray(records) ? records : [];
  if (!rows.length) {
    return {
      value: '—',
      note: 'Composition appears when responses are in view.',
      geographyCount: 0,
      topGeography: '',
      topRole: '',
    };
  }
  const geoMap = new Map(geography);
  const roleMap = new Map(roles);
  const geoTallies = new Map();
  const roleTallies = new Map();
  for (const row of rows) {
    const geo = String(row?.region || '').trim() || 'unknown';
    const role = String(row?.role || '').trim() || 'unknown';
    geoTallies.set(geo, (geoTallies.get(geo) || 0) + 1);
    roleTallies.set(role, (roleTallies.get(role) || 0) + 1);
  }
  const topGeo = [...geoTallies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const topRole = [...roleTallies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const geoLabel = geoMap.get(topGeo[0]) || topGeo[0];
  const roleLabel = roleMap.get(topRole[0]) || topRole[0];
  const geoVariety = geoTallies.size;
  const value = `${geoVariety} geograph${geoVariety === 1 ? 'y' : 'ies'}`;
  return {
    value,
    note: `Most represented: ${geoLabel}`,
    geographyCount: geoVariety,
    topGeography: geoLabel,
    topRole: roleLabel,
  };
}

export { statsFromCounts };
