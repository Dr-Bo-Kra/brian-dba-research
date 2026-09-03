/**
 * Pure helpers for BoardLens-style progressive disclosure on the DBA dashboard.
 * Builds descriptive drilldown content from summary and response DTOs already loaded
 * in the researcher workspace. No significance, causality, or evaluative claims.
 *
 * Hierarchy: plain-English answer → key evidence → optional detailed breakdown → methodology.
 */

import { rankItemHighlights } from './item-analysis.mjs';
import { relativeDomainLabel, SIMILARITY_THRESHOLD } from './insights.mjs';

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
  'representation',
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
 * Kept for detailed layers only — not headline copy.
 * @param {number|null|undefined} polarization
 * @returns {string}
 */
export function formatPolarizationLabel(polarization) {
  if (polarization == null || !Number.isFinite(Number(polarization))) return '';
  const pct = Math.round(Number(polarization) * 100);
  return `polarization ${pct}%`;
}

/**
 * Explains technical terms used in detailed evidence.
 * @param {string} term
 * @returns {string}
 */
export function explainTechnicalTerm(term) {
  const key = String(term || '').toLowerCase();
  if (key === 'n' || key === 'sample size') {
    return 'n is the count of accepted rating sets (or answers) included in this figure for the current filter.';
  }
  if (key === 'polarization') {
    return 'Polarization is the share of answers at the scale edges (1 and 7). It describes spread, not quality.';
  }
  if (key === 'sd' || key === 'sample sd') {
    return 'Sample SD is a descriptive measure of how spread out answers are around the mean on the 1–7 scale.';
  }
  if (key === 'mean') {
    return 'Mean is the arithmetic average on the survey’s 1–7 scale. It is descriptive only.';
  }
  return '';
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
    `${label} currently averages ${Number(mean).toFixed(2)} on the survey’s 1–7 scale ` +
    `across n = ${n} accepted rating set${n === 1 ? '' : 's'} in the current filter. ` +
    `This figure is a descriptive average only; it does not test difference, causation, or quality.`
  );
}

/**
 * Plain-English domain answer without leading with n / polarization.
 * @param {number|null|undefined} mean
 * @param {number} n
 * @param {string} label
 * @param {{ score?: number|null }[]} domains
 */
export function plainDomainAnswer(mean, n, label, domains = []) {
  if (mean == null || !n) {
    return `${label} has no accepted answers in the current filter yet.`;
  }
  const relative = relativeDomainLabel(mean, domains);
  const relativeClause = relative ? ` ${relative}.` : '';
  return (
    `${label} currently averages ${Number(mean).toFixed(2)} on the 1–7 scale.${relativeClause} ` +
    `Open the detailed breakdown for distributions and how this figure is calculated.`
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

function itemPreviewRows(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const label = item.label || item.id;
    const mean = item.mean == null ? '—' : Number(item.mean).toFixed(2);
    return [label, `${mean} / 7`];
  });
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

  if (kpiId === 'accepted' || kpiId === 'representation') {
    const geo = countByField(records, 'region', geography);
    const role = countByField(records, 'role', roles);
    const exp = countByField(records, 'experience', experience);
    const range = dateRangeLabel(trend, lastIntake, records);
    const isRep = kpiId === 'representation';
    const topGeo = geo[0]?.label;
    const topRole = role[0]?.label;
    const geoCountLabel = geo.length
      ? `${geo.length} geograph${geo.length === 1 ? 'y' : 'ies'}`
      : '—';
    return {
      kind: 'kpi',
      eyebrow: 'Study at a glance',
      title: isRep ? 'Participant composition' : 'Total responses',
      value: isRep ? geoCountLabel : String(total),
      summary: isRep
        ? total
          ? `Among responses currently shown, geography and role mix are summarised below. This describes the current page only — not the wider population.`
          : 'No responses are in view yet, so composition cannot be summarised.'
        : `${total} accepted response${total === 1 ? '' : 's'} in the current filter` +
          `${range !== '—' ? `, spanning ${range}` : ''}.`,
      observations: isRep
        ? [
            ['Geographies on this page', String(geo.length)],
            ['Most represented geography (this page)', topGeo || '—'],
            ['Most common role (this page)', topRole || '—'],
            ['Responses on this page', String(records.length)],
            ['Accepted in filter', String(total)],
          ]
        : [
            ['Accepted responses', String(total)],
            ['Date range', range],
            ['Geographies on this page', String(geo.length)],
            ['Roles on this page', String(role.length)],
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
          title: 'Detailed breakdown',
          kind: 'details',
          summaryLabel: 'Show full composition tables',
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
            {
              title: 'How to read this',
              rows: [
                ['Current page', 'Composition charts use responses currently shown and may be a subset of the full filter.'],
                ['Experience spread', experienceSpreadLabel(exp)],
              ],
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
      eyebrow: 'Study at a glance',
      title: 'Recent responses',
      value: String(recent),
      summary:
        recent === 0
          ? 'No responses were accepted in the last 24 hours within the current filter.'
          : `${recent} response${recent === 1 ? '' : 's'} accepted in the last 24 hours within the current filter.`,
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
          title: 'Detailed breakdown',
          kind: 'details',
          summaryLabel: 'Show recent daily counts',
          groups: [
            {
              title: 'Recent daily counts',
              rows: trend.slice(-14).map((row) => [formatResearchDate(row.day), String(row.count)]),
            },
          ],
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
        meta: relativeDomainLabel(domain.score, domains),
      }));
    return {
      kind: 'kpi',
      eyebrow: 'Study at a glance',
      title: 'Overall average score',
      value: formatScore(mean),
      summary:
        mean == null
          ? 'No overall average is available in the current filter yet.'
          : `The overall average across accepted responses is ${Number(mean).toFixed(2)} on the 1–7 scale. Theme averages below are separate descriptive figures for comparison.`,
      observations: [
        ['Overall average', formatScore(mean)],
        ['Accepted responses', String(total)],
        ['Scored responses on this page', String(scored.length)],
      ],
      sections: [
        {
          title: 'Theme comparison',
          kind: 'bars',
          bars: domainBars,
          valueSuffix: ' / 7',
        },
        {
          title: 'Detailed breakdown',
          kind: 'details',
          summaryLabel: 'Show score distribution on this page',
          distributionItems: [
            { id: 'overall', label: 'Overall score', counts: buckets, n: scored.length },
          ],
        },
      ],
      note:
        'The headline average summarises accepted responses in the current filter. Theme averages are independent descriptive averages and are not causal contributions. The distribution uses overall scores on the current workspace page only. Figures are descriptive, not causal.',
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
      eyebrow: 'Study at a glance',
      title: 'Latest response',
      value: headline,
      summary:
        lastIntake
          ? `The most recent accepted response in the current filter arrived on ${headline}.`
          : 'No accepted intake timestamp is available in the current filter.',
      observations: [
        ['Latest response', headline],
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
        'Latest response is the latest acceptance timestamp in the filtered archive. Free-text answers are not shown here.',
    };
  }

  return {
    kind: 'kpi',
    eyebrow: 'Study at a glance',
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
  const relative = relativeDomainLabel(mean, domains);

  return {
    kind: 'domain',
    eyebrow: 'Research theme',
    title,
    value: formatScore(mean),
    summary: plainDomainAnswer(mean, n, title, domains),
    observations: [
      ['Average score', formatScore(mean)],
      ['Relative standing', relative || '—'],
      ['Accepted rating sets (n)', String(n)],
      ['Questions in theme', String(domainItemIds.length)],
    ],
    sections: [
      {
        title: 'Higher-scoring questions',
        kind: 'items',
        items: ranked.highest,
      },
      {
        title: 'Lower-scoring questions',
        kind: 'items',
        items: ranked.lowest,
      },
      {
        title: 'More divided questions',
        kind: 'items',
        items: ranked.mostDivided,
      },
      {
        title: 'Detailed breakdown',
        kind: 'details',
        summaryLabel: 'Show full 1–7 distributions and glossary',
        distributionItems,
        groups: [
          {
            title: 'Glossary',
            rows: [
              ['n', explainTechnicalTerm('n')],
              ['Polarization', explainTechnicalTerm('polarization')],
              ['Mean', explainTechnicalTerm('mean')],
              [
                'Near-ties',
                `Theme scores within ${SIMILARITY_THRESHOLD.toFixed(2)} points are treated as similar in plain-English labels.`,
              ],
            ],
          },
          {
            title: 'Higher-scoring questions (compact)',
            rows: itemPreviewRows(ranked.highest),
          },
          {
            title: 'Lower-scoring questions (compact)',
            rows: itemPreviewRows(ranked.lowest),
          },
        ],
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
      'Theme averages and question distributions are descriptive summaries for the current filter. They do not claim significance, causation, or good/bad performance.',
  };
}
