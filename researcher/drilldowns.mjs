/**
 * Pure helpers for BoardLens-style progressive disclosure on the DBA dashboard.
 * Builds descriptive drilldown content from /v1/summary and /v1/responses DTOs.
 * No significance, causality, or evaluative claims.
 */

import { rankItemHighlights } from './item-analysis.mjs';

export const DOMAIN_ITEM_IDS = Object.freeze({
  psychometric: ['B1', 'B2', 'B3', 'B4', 'B5'],
  social: ['C6', 'C7', 'C8', 'C9', 'C10'],
  behavioral: ['D11', 'D12', 'D13', 'D14', 'D15'],
  readiness: ['E16', 'E17', 'E18', 'E19', 'E20'],
  inclusiveDecision: ['F21', 'F22', 'F23', 'F24', 'F25'],
});

export const KPI_IDS = Object.freeze([
  'accepted',
  'recent',
  'mean',
  'last-intake',
]);

/**
 * @param {unknown[]} records
 * @param {string} field
 * @param {[string, string][]} labelPairs
 * @returns {{ key: string, label: string, count: number }[]}
 */
export function countByField(records, field, labelPairs = []) {
  const labelMap = new Map(labelPairs);
  const tallies = new Map();
  for (const row of Array.isArray(records) ? records : []) {
    const key = String(row?.[field] || '').trim() || 'unknown';
    tallies.set(key, (tallies.get(key) || 0) + 1);
  }
  return [...tallies.entries()]
    .map(([key, count]) => ({
      key,
      label: labelMap.get(key) || key,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * @param {{ day?: string, count?: number }[]} trend
 * @returns {{ day: string, count: number }[]}
 */
export function normalizeTrend(trend) {
  return (Array.isArray(trend) ? trend : [])
    .map((row) => ({
      day: String(row?.day || ''),
      count: Number(row?.count) || 0,
    }))
    .filter((row) => row.day);
}

/**
 * @param {number|null|undefined} mean
 * @param {number} n
 * @param {string} label
 */
export function descriptiveDomainInterpretation(mean, n, label) {
  if (mean == null || !n) {
    return `${label} has no accepted rating sets in the current filter.`;
  }
  return (
    `${label} shows a mean of ${Number(mean).toFixed(2)} on the survey’s 1–7 scale ` +
    `across n = ${n} accepted rating set${n === 1 ? '' : 's'} in the current filter. ` +
    `This figure is a descriptive average only; it does not test difference, causation, or quality.`
  );
}

/**
 * @param {{ id: string, counts?: number[] }[]} items
 * @param {string} domainId
 * @param {{ labels?: Record<string, string>, highlightCount?: number }} [options]
 */
export function domainContributingItems(items, domainId, options = {}) {
  const ids = DOMAIN_ITEM_IDS[domainId] || [];
  const idSet = new Set(ids);
  const scoped = (Array.isArray(items) ? items : []).filter((item) => idSet.has(String(item?.id || '')));
  return rankItemHighlights(scoped, {
    labels: options.labels || {},
    highlightCount: Math.max(1, Number(options.highlightCount) || 3),
  });
}

function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(2)} / 7`;
}

function mapLabel(pairs, value) {
  const hit = pairs.find((row) => row[0] === value);
  return hit ? hit[1] : value || '—';
}

/**
 * @returns {{
 *   kind: string,
 *   eyebrow: string,
 *   title: string,
 *   value: string,
 *   summary: string,
 *   rows: [string, string][],
 *   sections: { title: string, kind: string, rows?: [string, string][], items?: object[], note?: string }[],
 *   note: string
 * }}
 */
export function buildKpiDrilldown(kpiId, context = {}) {
  const summary = context.summary || {};
  const records = Array.isArray(context.records) ? context.records : [];
  const geography = context.geography || [];
  const roles = context.roles || [];
  const experience = context.experience || [];
  const domains = Array.isArray(summary.domains) ? summary.domains : [];
  const trend = normalizeTrend(summary.trend);
  const total = Number(summary.total) || 0;
  const recent = Number(summary.last_24h) || 0;
  const mean = summary.mean_orientation;
  const lastIntake = summary.last_intake || null;

  if (kpiId === 'accepted') {
    const geo = countByField(records, 'region', geography);
    const role = countByField(records, 'role', roles);
    const exp = countByField(records, 'experience', experience);
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Accepted responses',
      value: String(total),
      summary:
        'Count of accepted responses in the current filter. Breakdowns below use the loaded ledger page and remain descriptive only.',
      rows: [
        ['Accepted responses', String(total)],
        ['Loaded ledger rows', String(records.length)],
        ['Daily trend points', String(trend.length)],
      ],
      sections: [
        {
          title: 'Arrival pattern (by day)',
          kind: 'trend',
          rows: trend.map((row) => [row.day, String(row.count)]),
        },
        {
          title: 'Geography (loaded rows)',
          kind: 'breakdown',
          rows: geo.map((row) => [row.label, String(row.count)]),
        },
        {
          title: 'Role (loaded rows)',
          kind: 'breakdown',
          rows: role.map((row) => [row.label, String(row.count)]),
        },
        {
          title: 'Experience (loaded rows)',
          kind: 'breakdown',
          rows: exp.map((row) => [row.label, String(row.count)]),
        },
      ],
      note: 'Methodological note: totals come from /v1/summary; composition tables use the currently loaded /v1/responses page and may be a subset of the filtered archive.',
    };
  }

  if (kpiId === 'recent') {
    const recentRecords = records
      .slice()
      .sort((a, b) => String(b.accepted_at || '').localeCompare(String(a.accepted_at || '')))
      .slice(0, 12);
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Recent responses',
      value: String(recent),
      summary:
        'Responses accepted in the last 24 hours within the current filter, with a short timeline of the most recent loaded records.',
      rows: [
        ['Last 24 hours', String(recent)],
        ['Accepted (filter)', String(total)],
        ['Shown in timeline', String(recentRecords.length)],
      ],
      sections: [
        {
          title: 'Recent records',
          kind: 'records',
          rows: recentRecords.map((row) => [
            String(row.participant_reference || '—'),
            `${mapLabel(roles, row.role)} · ${mapLabel(geography, row.region)} · ${row.accepted_at || '—'}`,
          ]),
        },
        {
          title: 'Daily counts',
          kind: 'trend',
          rows: trend.slice(-14).map((row) => [row.day, String(row.count)]),
        },
      ],
      note: 'Methodological note: the 24-hour count is from /v1/summary. The timeline lists loaded ledger rows only and does not include free-text answers.',
    };
  }

  if (kpiId === 'mean') {
    const scored = records
      .map((row) => Number(row.orientation))
      .filter((value) => Number.isFinite(value));
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    scored.forEach((value) => {
      const idx = Math.min(6, Math.max(0, Math.round(value) - 1));
      buckets[idx] += 1;
    });
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Overall mean score',
      value: formatScore(mean),
      summary:
        'Average of each response’s overall desk assessment score on the 1–7 scale for accepted responses in the current filter.',
      rows: [
        ['Overall mean', formatScore(mean)],
        ['Accepted responses', String(total)],
        ['Loaded scored rows', String(scored.length)],
      ],
      sections: [
        {
          title: 'Domain contribution (means)',
          kind: 'breakdown',
          rows: domains.map((domain) => [
            domain.label || domain.id,
            domain.score == null ? '—' : `${Number(domain.score).toFixed(2)} / 7 (n = ${Number(domain.n) || 0})`,
          ]),
        },
        {
          title: 'Overall score distribution (loaded rows, rounded)',
          kind: 'distribution',
          items: [{ id: 'overall', label: 'Overall score', counts: buckets, n: scored.length }],
        },
      ],
      note: 'Methodological note: the headline mean is from /v1/summary. Domain means are independent domain averages, not causal contributions. Distribution uses loaded ledger overall scores only.',
    };
  }

  if (kpiId === 'last-intake') {
    const recentRecords = records
      .slice()
      .sort((a, b) => String(b.accepted_at || '').localeCompare(String(a.accepted_at || '')))
      .slice(0, 8);
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Last intake',
      value: lastIntake ? String(lastIntake) : '—',
      summary:
        'Timestamp of the most recent accepted response in the current filter, with nearby loaded context for orientation.',
      rows: [
        ['Last intake', lastIntake ? String(lastIntake) : '—'],
        ['Accepted (filter)', String(total)],
        ['Last 24 hours', String(recent)],
      ],
      sections: [
        {
          title: 'Nearby loaded records',
          kind: 'records',
          rows: recentRecords.map((row) => [
            String(row.participant_reference || '—'),
            `${row.accepted_at || '—'} · ${formatScore(row.orientation)}`,
          ]),
        },
      ],
      note: 'Methodological note: last intake is derived from accepted_at in /v1/summary. Free-text answers are not shown here.',
    };
  }

  return {
    kind: 'kpi',
    eyebrow: 'Study overview',
    title: 'Insight',
    value: '—',
    summary: 'No drilldown is available for this signal.',
    rows: [],
    sections: [],
    note: 'Descriptive view only.',
  };
}

/**
 * @returns {ReturnType<typeof buildKpiDrilldown>}
 */
export function buildDomainDrilldown(domainId, context = {}) {
  const summary = context.summary || {};
  const records = Array.isArray(context.records) ? context.records : [];
  const geography = context.geography || [];
  const roles = context.roles || [];
  const experience = context.experience || [];
  const labels = context.itemLabels || {};
  const domains = Array.isArray(summary.domains) ? summary.domains : [];
  const domain =
    domains.find((row) => row.id === domainId) ||
    (context.domainFallback && context.domainFallback.id === domainId
      ? context.domainFallback
      : null);
  const title = domain?.label || domainId;
  const mean = domain?.score ?? null;
  const n = Number(domain?.n) || 0;
  const contributing = domainContributingItems(summary.items || [], domainId, {
    labels,
    highlightCount: 3,
  });

  return {
    kind: 'domain',
    eyebrow: 'Research domain',
    title,
    value: formatScore(mean),
    summary: descriptiveDomainInterpretation(mean, n, title),
    rows: [
      ['Domain mean', formatScore(mean)],
      ['Accepted rating sets (n)', String(n)],
      ['Items in domain', String((DOMAIN_ITEM_IDS[domainId] || []).length)],
    ],
    sections: [
      {
        title: 'Strongest contributing items',
        kind: 'items',
        items: contributing.highest,
      },
      {
        title: 'Weakest contributing items',
        kind: 'items',
        items: contributing.lowest,
      },
      {
        title: 'Most divided contributing items',
        kind: 'items',
        items: contributing.mostDivided,
      },
      {
        title: 'Participation composition (loaded rows)',
        kind: 'breakdown',
        rows: [
          ...countByField(records, 'region', geography)
            .slice(0, 6)
            .map((row) => [`Geography · ${row.label}`, String(row.count)]),
          ...countByField(records, 'role', roles)
            .slice(0, 6)
            .map((row) => [`Role · ${row.label}`, String(row.count)]),
          ...countByField(records, 'experience', experience)
            .slice(0, 5)
            .map((row) => [`Experience · ${row.label}`, String(row.count)]),
        ],
      },
      {
        title: 'Qualitative answers',
        kind: 'note',
        note: 'Free-text answers are not included here. Use the gated Qualitative responses section, which calls the dedicated protected qualitative endpoint after an explicit researcher action.',
      },
    ],
    note: 'Methodological note: domain means and item distributions are descriptive summaries for the current filter. They do not claim significance, causation, or good/bad performance.',
  };
}
