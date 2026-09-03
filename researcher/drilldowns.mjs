/**
 * Pure helpers for BoardLens-style progressive disclosure on the DBA dashboard.
 * Builds descriptive drilldown content from summary and response DTOs already loaded
 * in the researcher workspace. No significance, causality, or evaluative claims.
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

const MONTHS = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);

/**
 * Human-readable UTC datetime for researcher UI. Never returns raw ISO.
 * Example: "1 Sep 2026, 10:30 AM"
 * @param {unknown} value
 * @returns {string}
 */
export function formatResearchDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  let hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${meridiem}`;
}

/**
 * Human-readable UTC date (no time). Example: "1 Sep 2026"
 * @param {unknown} value
 * @returns {string}
 */
export function formatResearchDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Shorten a participant reference for secondary display.
 * @param {unknown} ref
 * @returns {string}
 */
export function shortenParticipantRef(ref) {
  const value = String(ref || '').trim();
  if (!value) return '—';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/**
 * Share of ratings at the scale edges (1 and 7), labeled for researchers.
 * @param {number|null|undefined} polarization
 * @returns {string}
 */
export function formatPolarizationLabel(polarization) {
  if (polarization == null || !Number.isFinite(Number(polarization))) return '';
  const pct = Math.round(Number(polarization) * 100);
  return `polarization ${pct}%`;
}

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
 * Domain-scoped item ranks (highest / lowest / most divided).
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

function dateRangeLabel(trend, lastIntake, records) {
  const days = normalizeTrend(trend).map((row) => row.day).filter(Boolean);
  if (days.length) {
    const sorted = [...days].sort();
    const first = formatResearchDate(sorted[0]);
    const last = formatResearchDate(sorted[sorted.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }
  const stamps = (Array.isArray(records) ? records : [])
    .map((row) => String(row?.accepted_at || ''))
    .filter(Boolean)
    .sort();
  if (stamps.length) {
    const first = formatResearchDate(stamps[0]);
    const last = formatResearchDate(stamps[stamps.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }
  if (lastIntake) return formatResearchDate(lastIntake);
  return '—';
}

function experienceSpreadLabel(expCounts) {
  if (!expCounts.length) return 'No experience bands in the current page';
  if (expCounts.length === 1) return expCounts[0].label;
  const top = expCounts.slice(0, 3).map((row) => `${row.label} (${row.count})`);
  return top.join(', ');
}

function barRows(rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count) || 0));
  return rows.map((row) => ({
    label: row.label,
    count: row.count,
    share: (row.count / max) * 100,
  }));
}

/**
 * @returns {{
 *   kind: string,
 *   eyebrow: string,
 *   title: string,
 *   value: string,
 *   summary: string,
 *   observations: [string, string][],
 *   sections: object[],
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
    const range = dateRangeLabel(trend, lastIntake, records);
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Accepted responses',
      value: String(total),
      summary:
        `${total} accepted response${total === 1 ? '' : 's'} in the current filter` +
        `${range !== '—' ? `, spanning ${range}` : ''}. ` +
        `Current page covers ${geo.length} geograph${geo.length === 1 ? 'y' : 'ies'}, ` +
        `${role.length} role${role.length === 1 ? '' : 's'}, and experience spread: ${experienceSpreadLabel(exp)}.`,
      observations: [
        ['Accepted responses', String(total)],
        ['Date range', range],
        ['Geographies (current page)', String(geo.length)],
        ['Roles (current page)', String(role.length)],
        ['Experience bands (current page)', String(exp.length)],
      ],
      sections: [
        {
          title: 'Arrival pattern',
          kind: 'bars',
          bars: barRows(
            trend.map((row) => ({
              label: formatResearchDate(row.day),
              count: row.count,
            }))
          ),
        },
        {
          title: 'Geography',
          kind: 'bars',
          bars: barRows(geo),
        },
        {
          title: 'Role',
          kind: 'bars',
          bars: barRows(role),
        },
        {
          title: 'Experience',
          kind: 'bars',
          bars: barRows(exp),
        },
        {
          title: 'Full composition tables',
          kind: 'details',
          summaryLabel: 'Show full tables',
          groups: [
            {
              title: 'Geography',
              rows: geo.map((row) => [row.label, String(row.count)]),
            },
            {
              title: 'Role',
              rows: role.map((row) => [row.label, String(row.count)]),
            },
            {
              title: 'Experience',
              rows: exp.map((row) => [row.label, String(row.count)]),
            },
            {
              title: 'Daily arrivals',
              rows: trend.map((row) => [formatResearchDate(row.day), String(row.count)]),
            },
          ],
        },
      ],
      note:
        'Totals reflect the filtered archive. Composition visuals use the responses currently shown in the workspace (paginated) and may be a subset of the full filter. Figures are descriptive only.',
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
        `${recent} response${recent === 1 ? '' : 's'} accepted in the last 24 hours within the current filter. ` +
        `The activity list below emphasises when each response arrived, along with role and geography.`,
      observations: [
        ['Last 24 hours', String(recent)],
        ['Accepted in filter', String(total)],
        ['Activity entries shown', String(recentRecords.length)],
      ],
      sections: [
        {
          title: 'Recent activity',
          kind: 'activity',
          activity: recentRecords.map((row) => ({
            when: formatResearchDateTime(row.accepted_at),
            role: mapLabel(roles, row.role),
            geography: mapLabel(geography, row.region),
            reference: shortenParticipantRef(row.participant_reference),
          })),
        },
        {
          title: 'Recent daily counts',
          kind: 'bars',
          bars: barRows(
            trend.slice(-14).map((row) => ({
              label: formatResearchDate(row.day),
              count: row.count,
            }))
          ),
        },
      ],
      note:
        'The 24-hour count is an archive total for the current filter. The activity list shows responses currently available in the workspace and does not include free-text answers.',
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
    const domainBars = domains
      .filter((domain) => domain.score != null)
      .map((domain) => ({
        label: domain.label || domain.id,
        count: Number(domain.score),
        share: (Number(domain.score) / 7) * 100,
        meta: `n = ${Number(domain.n) || 0}`,
      }));
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Overall mean score',
      value: formatScore(mean),
      summary:
        'Average of each accepted response’s overall score on the survey’s 1–7 scale in the current filter. ' +
        'Domain means below are independent descriptive averages for comparison, not parts of a causal model.',
      observations: [
        ['Overall mean', formatScore(mean)],
        ['Accepted responses', String(total)],
        ['Scored responses on this page', String(scored.length)],
      ],
      sections: [
        {
          title: 'Domain comparison',
          kind: 'bars',
          bars: domainBars,
          valueSuffix: ' / 7',
        },
        {
          title: 'Overall score distribution (rounded, current page)',
          kind: 'distribution',
          items: [{ id: 'overall', label: 'Overall score', counts: buckets, n: scored.length }],
        },
      ],
      note:
        'The headline mean summarises accepted responses in the current filter. Domain means are independent descriptive averages and are not causal contributions. The distribution uses overall scores on the current workspace page only. Figures are descriptive, not causal.',
    };
  }

  if (kpiId === 'last-intake') {
    const recentRecords = records
      .slice()
      .sort((a, b) => String(b.accepted_at || '').localeCompare(String(a.accepted_at || '')))
      .slice(0, 8);
    const headline = lastIntake ? formatResearchDateTime(lastIntake) : '—';
    return {
      kind: 'kpi',
      eyebrow: 'Study overview',
      title: 'Last intake',
      value: headline,
      summary:
        lastIntake
          ? `Most recent accepted response in the current filter arrived ${headline}. Nearby records below provide orientation around that intake.`
          : 'No accepted intake timestamp is available in the current filter.',
      observations: [
        ['Last intake', headline],
        ['Accepted in filter', String(total)],
        ['Last 24 hours', String(recent)],
      ],
      sections: [
        {
          title: 'Nearby records',
          kind: 'activity',
          activity: recentRecords.map((row) => ({
            when: formatResearchDateTime(row.accepted_at),
            role: mapLabel(roles, row.role),
            geography: mapLabel(geography, row.region),
            reference: shortenParticipantRef(row.participant_reference),
            score: formatScore(row.orientation),
          })),
        },
      ],
      note:
        'Last intake is the latest acceptance timestamp in the filtered archive. Free-text answers are not shown here.',
    };
  }

  return {
    kind: 'kpi',
    eyebrow: 'Study overview',
    title: 'Insight',
    value: '—',
    summary: 'No drilldown is available for this signal.',
    observations: [],
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
  const ranked = domainContributingItems(summary.items || [], domainId, {
    labels,
    highlightCount: 3,
  });
  const domainItemIds = DOMAIN_ITEM_IDS[domainId] || [];
  const idSet = new Set(domainItemIds);
  const distributionItems =
    ranked.all.length > 0
      ? ranked.all
      : (Array.isArray(summary.items) ? summary.items : [])
          .filter((item) => idSet.has(String(item?.id || '')))
          .map((item) => ({
            id: String(item.id),
            label: labels[item.id] || '',
            counts: Array.isArray(item.counts) ? item.counts : [0, 0, 0, 0, 0, 0, 0],
            n: (Array.isArray(item.counts) ? item.counts : []).reduce(
              (sum, count) => sum + (Number(count) || 0),
              0
            ),
            mean: null,
            polarization: null,
          }));
  const participation = [
    ...countByField(records, 'region', geography)
      .slice(0, 6)
      .map((row) => ({ label: `Geography · ${row.label}`, count: row.count })),
    ...countByField(records, 'role', roles)
      .slice(0, 6)
      .map((row) => ({ label: `Role · ${row.label}`, count: row.count })),
    ...countByField(records, 'experience', experience)
      .slice(0, 5)
      .map((row) => ({ label: `Experience · ${row.label}`, count: row.count })),
  ];

  return {
    kind: 'domain',
    eyebrow: 'Research domain',
    title,
    value: formatScore(mean),
    summary: descriptiveDomainInterpretation(mean, n, title),
    observations: [
      ['Domain score', formatScore(mean)],
      ['Accepted rating sets (n)', String(n)],
      ['Items in domain', String(domainItemIds.length)],
    ],
    sections: [
      {
        title: 'Highest items',
        kind: 'items',
        items: ranked.highest,
      },
      {
        title: 'Lowest items',
        kind: 'items',
        items: ranked.lowest,
      },
      {
        title: 'Most divided items',
        kind: 'items',
        items: ranked.mostDivided,
      },
      {
        title: 'Full item distributions',
        kind: 'details',
        summaryLabel: 'Show full 1–7 distributions',
        distributionItems,
      },
      {
        title: 'Participation context',
        kind: 'bars',
        bars: barRows(participation),
      },
      {
        title: 'Qualitative answers',
        kind: 'note',
        note: 'Free-text answers are not included here. Use the gated Free-text answers section after an explicit researcher opt-in.',
      },
    ],
    note:
      'Domain means and item distributions are descriptive summaries for the current filter. They do not claim significance, causation, or good/bad performance.',
  };
}
