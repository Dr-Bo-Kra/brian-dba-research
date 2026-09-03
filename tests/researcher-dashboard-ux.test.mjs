import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HIGHLIGHT_COUNT,
  rankItemHighlights,
  statsFromCounts,
} from '../researcher/item-analysis.mjs';
import {
  assertDescriptiveInsightCopy,
  bannedWordsInText,
  buildStudyInsights,
  formatNameList,
  participationGlanceCopy,
  rankDomainsByMean,
  relativeDomainLabel,
  SIMILARITY_THRESHOLD,
} from '../researcher/insights.mjs';
import {
  buildDomainDrilldown,
  buildKpiDrilldown,
  countByField,
  descriptiveDomainInterpretation,
  domainContributingItems,
  DOMAIN_ITEM_IDS,
  formatPolarizationLabel,
  formatResearchDate,
  formatResearchDateTime,
  shortenParticipantRef,
} from '../researcher/drilldowns.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const ITEM_LABELS = {
  B1: 'Financial discipline and loan recommendation',
  B2: 'Repayment commitment',
  B3: 'Responsible financial planning',
  C6: 'Community reputation',
  D11: 'Consistent financial decisions',
  D15: 'Behavioural characteristics and decision quality',
};

test('statsFromCounts computes n, mean, sample SD, and polarization', () => {
  const counts = [1, 0, 0, 0, 0, 0, 1]; // values 1 and 7
  const stats = statsFromCounts(counts);
  assert.equal(stats.n, 2);
  assert.equal(stats.mean, 4);
  assert.equal(stats.sdKind, 'sample');
  assert.ok(Math.abs(stats.sd - Math.SQRT2 * 3) < 1e-9); // sample SD of {1,7}
  assert.equal(stats.polarization, 1);

  const single = statsFromCounts([0, 0, 1, 0, 0, 0, 0]);
  assert.equal(single.n, 1);
  assert.equal(single.mean, 3);
  assert.equal(single.sdKind, 'population');
  assert.equal(single.sd, 0);
  assert.equal(single.polarization, 0);

  const empty = statsFromCounts([]);
  assert.equal(empty.n, 0);
  assert.equal(empty.mean, null);
  assert.equal(empty.sd, null);
  assert.equal(empty.polarization, null);
});

test('rankItemHighlights selects highest, lowest, and most divided items', () => {
  const items = [
    { id: 'A', counts: [0, 0, 0, 0, 0, 0, 10] }, // mean 7, P=1, SD=0
    { id: 'B', counts: [10, 0, 0, 0, 0, 0, 0] }, // mean 1, P=1, SD=0
    { id: 'C', counts: [0, 0, 0, 10, 0, 0, 0] }, // mean 4, P=0
    { id: 'D', counts: [5, 0, 0, 0, 0, 0, 5] }, // mean 4, P=1, high SD
    { id: 'E', counts: [0, 0, 0, 0, 0, 8, 2] }, // mean ~6.2
    { id: 'F', counts: [2, 8, 0, 0, 0, 0, 0] }, // mean ~1.8
  ];
  const ranked = rankItemHighlights(items, {
    labels: { A: 'High', B: 'Low' },
    highlightCount: 3,
  });
  assert.equal(DEFAULT_HIGHLIGHT_COUNT, 5);
  assert.deepEqual(
    ranked.highest.map((row) => row.id),
    ['A', 'E', 'C']
  );
  assert.deepEqual(
    ranked.lowest.map((row) => row.id),
    ['B', 'F', 'C']
  );
  assert.deepEqual(
    ranked.mostDivided.map((row) => row.id),
    ['D', 'A', 'B']
  );
  assert.equal(ranked.highest[0].label, 'High');
  assert.equal(ranked.lowest[0].label, 'Low');
  assert.equal(ranked.all.length, 6);
});

test('research date formatting never returns raw ISO in UI helpers', () => {
  assert.equal(formatResearchDateTime('2026-09-01T10:30:00.000Z'), '1 Sep 2026, 10:30 AM');
  assert.equal(formatResearchDateTime('2026-09-01T22:05:00.000Z'), '1 Sep 2026, 10:05 PM');
  assert.equal(formatResearchDate('2026-09-01'), '1 Sep 2026');
  assert.equal(formatResearchDateTime(null), '—');
  assert.equal(formatResearchDateTime('not-a-date'), '—');
  assert.doesNotMatch(formatResearchDateTime('2026-09-01T10:30:00.000Z'), /T\d{2}:\d{2}/);
  assert.equal(formatPolarizationLabel(0.42), 'polarization 42%');
  assert.equal(formatPolarizationLabel(null), '');
  assert.equal(
    shortenParticipantRef('resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    'resp_aaa…aaaa'
  );
});

test('insight copy stays descriptive and avoids banned inferential language', () => {
  assert.equal(formatNameList(['A', 'B']), 'A and B');
  assert.equal(SIMILARITY_THRESHOLD, 0.15);

  const domains = [
    { id: 'behavioral', label: 'Behavioral economics', score: 5.8, n: 40 },
    { id: 'psychometric', label: 'Psychometric indicators', score: 5.4, n: 40 },
    { id: 'readiness', label: 'Organizational readiness', score: 5.35, n: 40 },
    { id: 'social', label: 'Social capital', score: 4.6, n: 40 },
    { id: 'inclusiveDecision', label: 'Inclusive decision-making', score: 4.55, n: 40 },
  ];
  const ranked = rankDomainsByMean(domains);
  assert.equal(ranked[0].id, 'behavioral');
  assert.equal(relativeDomainLabel(5.8, domains), 'Highest currently');
  assert.equal(relativeDomainLabel(5.4, domains), 'Close to the overall pattern');
  assert.equal(relativeDomainLabel(4.55, domains), 'Slightly lower');
  assert.equal(
    relativeDomainLabel(5.0, [
      { id: 'a', label: 'A', score: 5.05, n: 10 },
      { id: 'b', label: 'B', score: 4.95, n: 10 },
    ]),
    'Close to the overall pattern'
  );

  const items = [
    { id: 'B1', counts: [0, 0, 0, 10, 0, 0, 0] }, // low SD
    { id: 'B2', counts: [5, 0, 0, 0, 0, 0, 5] }, // high SD
    { id: 'B3', counts: [0, 0, 2, 6, 2, 0, 0] },
    { id: 'D11', counts: [0, 1, 1, 7, 1, 0, 0] },
  ];
  const insights = buildStudyInsights(
    { domains, items, total: 40 },
    { labels: ITEM_LABELS, maxInsights: 4 }
  );
  assert.ok(insights.length >= 2);
  assert.ok(insights.some((row) => /Behavioral economics currently has the highest average score/.test(row.headline)));
  assert.ok(
    insights.some((row) =>
      /Social capital and Inclusive decision-making currently have the lowest averages/.test(row.headline)
    )
  );
  assert.ok(insights.some((row) => /most consistent/.test(row.headline)));
  assert.ok(insights.some((row) => /vary more than most other questions/.test(row.headline)));
  assert.ok(insights.some((row) => row.headline.includes('Financial discipline')));
  assert.doesNotMatch(insights.map((row) => row.headline).join(' '), /\bB1\b/);
  for (const insight of insights) {
    assert.equal(bannedWordsInText(insight.headline).length, 0);
    assert.equal(bannedWordsInText(insight.detail).length, 0);
  }
  assert.doesNotThrow(() =>
    assertDescriptiveInsightCopy(insights.flatMap((row) => [row.headline, row.detail]))
  );
  assert.throws(() => assertDescriptiveInsightCopy('This is significant evidence'));
  assert.throws(() => assertDescriptiveInsightCopy('This proves the model is effective'));

  const nearTie = buildStudyInsights(
    {
      domains: [
        { id: 'a', label: 'Theme A', score: 5.1, n: 20 },
        { id: 'b', label: 'Theme B', score: 5.05, n: 20 },
        { id: 'c', label: 'Theme C', score: 5.0, n: 20 },
      ],
      items,
      total: 20,
    },
    { labels: ITEM_LABELS, maxInsights: 4 }
  );
  assert.ok(nearTie.some((row) => /similar average scores/.test(row.headline)));
  assert.ok(!nearTie.some((row) => /highest average score\./.test(row.headline)));

  const glance = participationGlanceCopy(
    [
      { region: 'india', role: 'credit-manager' },
      { region: 'india', role: 'risk-manager' },
      { region: 'europe-uk', role: 'credit-manager' },
    ],
    [
      ['india', 'India'],
      ['europe-uk', 'Europe or United Kingdom'],
    ],
    [
      ['credit-manager', 'Credit Manager'],
      ['risk-manager', 'Risk Manager or Risk Analyst'],
    ]
  );
  assert.match(glance.value, /India/);
  assert.match(glance.note, /Credit Manager/);
  assert.doesNotMatch(glance.note, /representative|population|significant/i);
});

test('dashboard IA order and progressive disclosure shell match redesign', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  const css = read('researcher/dashboard.css');

  const overview = html.indexOf('id="overview-title"');
  const insights = html.indexOf('id="insights-title"');
  const domains = html.indexOf('id="compass-title"');
  const refine = html.indexOf('id="refine-title"');
  const explore = html.indexOf('id="explore-title"');
  const items = html.indexOf('id="items-title"');
  const ledger = html.indexOf('id="ledger-title"');
  const qualitative = html.indexOf('id="reflections-title"');
  const admin = html.indexOf('id="admin-title"');
  assert.ok(overview > 0 && insights > overview);
  assert.ok(domains > insights && refine > domains);
  assert.ok(explore > refine && items > explore);
  assert.ok(ledger > items && qualitative > ledger && admin > qualitative);

  assert.match(html, /DBA Research Dashboard/);
  assert.match(html, /Inclusive Lending Study/);
  assert.match(html, /Study at a glance/);
  assert.match(html, /What we’re learning|What we're learning/);
  assert.match(html, /How the five research themes compare/);
  assert.match(html, /Total responses/);
  assert.match(html, /Recent responses/);
  assert.match(html, /Latest response/);
  assert.match(html, /Who’s responding|Who's responding/);
  assert.match(html, /data-drill="kpi:accepted"/);
  assert.match(html, /data-drill="kpi:recent"/);
  assert.match(html, /data-drill="kpi:last-intake"/);
  assert.match(html, /data-drill="kpi:representation"/);
  assert.match(html, /id="drill-drawer"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /item-all-details/);
  assert.match(html, /All questions — full distributions/);
  assert.match(html, /admin-panel/);
  assert.match(html, /<details class="workspace-panel admin-panel"/);
  assert.match(html, /participation-panel/);
  assert.match(html, /<details class="workspace-panel participation-panel"/);
  assert.match(html, /ledger-meta/);
  assert.match(html, /ledger-pager/);
  assert.match(html, /Overall score/);
  assert.match(html, /Calculation and methodology notes/);
  assert.doesNotMatch(html, /desk assessment/i);
  assert.doesNotMatch(html, /significant differences/i);
  assert.doesNotMatch(html, /\bAI\b|theme extraction|auto-generated themes/i);
  assert.doesNotMatch(html, /Board implication|synergy register|EBITDA/i);
  assert.doesNotMatch(html, /dedicated qualitative endpoint/i);
  assert.doesNotMatch(html, /\/v1\/summary/);
  assert.doesNotMatch(html, /Overall mean score/);

  assert.match(js, /from '\.\/item-analysis\.mjs'/);
  assert.match(js, /from '\.\/drilldowns\.mjs'/);
  assert.match(js, /from '\.\/insights\.mjs'/);
  assert.match(js, /rankItemHighlights/);
  assert.match(js, /buildStudyInsights/);
  assert.match(js, /buildKpiDrilldown/);
  assert.match(js, /buildDomainDrilldown/);
  assert.match(js, /formatResearchDateTime/);
  assert.match(js, /In plain English/);
  assert.match(js, /Key evidence/);
  assert.match(js, /Detailed breakdown/);
  assert.match(js, /Methodological context/);
  assert.match(js, /RESPONSE_PAGE_LIMIT = 10/);
  assert.match(js, /RESPONSE_FETCH_LIMIT = 50/);
  assert.match(js, /openDrilldown/);
  assert.match(js, /closeDrilldown/);
  assert.match(js, /LIVE_EXPORTS_ENABLED = false/);
  assert.match(js, /LIVE_DELETIONS_ENABLED = false/);
  assert.match(js, /\/v1\/responses\/\$\{encodeURIComponent\(ref\)\}\/qualitative/);
  assert.match(js, /revealBox\?\.checked/);
  assert.match(js, /polarization/);
  assert.match(js, /item-question/);
  assert.match(js, /item-id-secondary/);
  assert.doesNotMatch(js, /· P =/);
  assert.doesNotMatch(js, /include_qualitative/);
  assert.doesNotMatch(js, /significant differences/i);
  assert.doesNotMatch(js, /loaded rows/i);
  assert.doesNotMatch(js, /ledger rows/i);
  assert.doesNotMatch(js, /desk assessment/i);

  assert.match(css, /item-highlight/);
  assert.match(css, /insight-card/);
  assert.match(css, /admin-panel/);
  assert.match(css, /participation-panel/);
  assert.match(css, /drawer-layer/);
  assert.match(css, /kpi-card/);
  assert.match(css, /ledger-pager/);
  assert.match(css, /drawer-bars/);
  assert.match(css, /drawer-activity/);
  assert.match(css, /dist-scale-spark/);
  assert.match(css, /\.dist-col\.is-empty/);
  assert.match(css, /domain-bar-muted/);
});

test('clickable KPI and domain drilldowns are wired with accessible panel controls', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  const css = read('researcher/dashboard.css');

  assert.match(html, /class="kpi-card drill"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-controls="drill-drawer"/);
  assert.match(html, /id="drill-close"/);
  assert.match(js, /data-drill/);
  assert.match(js, /domain-score drill/);
  assert.match(js, /setAttribute\('aria-label', `Explore details for/);
  assert.match(js, /event\.key === 'Escape'/);
  assert.match(js, /getFocusable\(drillDrawer\)/);
  assert.match(css, /\.drawer\b/);
  assert.match(css, /body\.drawer-open/);
});

test('drilldown calculations stay descriptive and domain-scoped', () => {
  const items = [
    { id: 'B1', counts: [0, 0, 0, 0, 0, 0, 10] },
    { id: 'B2', counts: [10, 0, 0, 0, 0, 0, 0] },
    { id: 'B3', counts: [5, 0, 0, 0, 0, 0, 5] },
    { id: 'C6', counts: [0, 0, 0, 10, 0, 0, 0] },
  ];
  const contributing = domainContributingItems(items, 'psychometric', {
    labels: { B1: 'High', B2: 'Low' },
    highlightCount: 2,
  });
  assert.deepEqual(DOMAIN_ITEM_IDS.psychometric, ['B1', 'B2', 'B3', 'B4', 'B5']);
  assert.deepEqual(
    contributing.highest.map((row) => row.id),
    ['B1', 'B3']
  );
  assert.deepEqual(
    contributing.lowest.map((row) => row.id),
    ['B2', 'B3']
  );
  assert.ok(!contributing.all.some((row) => row.id === 'C6'));

  const interpretation = descriptiveDomainInterpretation(5.25, 12, 'Social capital');
  assert.match(interpretation, /averages 5\.25/);
  assert.match(interpretation, /n = 12/);
  assert.doesNotMatch(interpretation, /significant|causal|good|bad|underperform/i);

  const records = [
    { region: 'india', role: 'credit-manager', experience: '2-5', orientation: 6.1, accepted_at: '2026-08-10T10:00:00Z', participant_reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { region: 'india', role: 'risk-manager', experience: '6-10', orientation: 4.2, accepted_at: '2026-08-11T10:00:00Z', participant_reference: 'resp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    { region: 'europe-uk', role: 'credit-manager', experience: '2-5', orientation: 5.0, accepted_at: '2026-08-12T10:00:00Z', participant_reference: 'resp_cccccccccccccccccccccccccccccccc' },
  ];
  const geo = countByField(records, 'region', [['india', 'India'], ['europe-uk', 'Europe or United Kingdom']]);
  assert.deepEqual(geo.map((row) => [row.label, row.count]), [
    ['India', 2],
    ['Europe or United Kingdom', 1],
  ]);

  const accepted = buildKpiDrilldown('accepted', {
    summary: {
      total: 48,
      last_24h: 3,
      mean_orientation: 5.1,
      last_intake: '2026-08-12T10:00:00Z',
      trend: [{ day: '2026-08-10', count: 2 }, { day: '2026-08-11', count: 1 }],
      domains: [{ id: 'psychometric', label: 'Psychometric indicators', score: 5.4, n: 40 }],
      items,
    },
    records,
    geography: [['india', 'India'], ['europe-uk', 'Europe or United Kingdom']],
    roles: [['credit-manager', 'Credit Manager'], ['risk-manager', 'Risk Manager or Risk Analyst']],
    experience: [['2-5', '2-5 years'], ['6-10', '6-10 years']],
  });
  assert.equal(accepted.title, 'Total responses');
  assert.equal(accepted.value, '48');
  assert.ok(accepted.observations.some((row) => row[0] === 'Date range'));
  assert.ok(accepted.sections.some((section) => section.title === 'Geography' && section.kind === 'bars'));
  assert.ok(accepted.sections.some((section) => section.kind === 'details'));
  assert.doesNotMatch(JSON.stringify(accepted), /significant|causation|good\/bad|underperform/i);
  assert.doesNotMatch(JSON.stringify(accepted), /loaded rows|ledger rows|\/v1\//i);

  const recent = buildKpiDrilldown('recent', {
    summary: {
      total: 3,
      last_24h: 1,
      last_intake: '2026-08-12T10:00:00Z',
      trend: [{ day: '2026-08-12', count: 1 }],
      items,
    },
    records,
    geography: [['india', 'India'], ['europe-uk', 'Europe or United Kingdom']],
    roles: [['credit-manager', 'Credit Manager'], ['risk-manager', 'Risk Manager or Risk Analyst']],
  });
  assert.equal(recent.title, 'Recent responses');
  const activity = recent.sections.find((section) => section.kind === 'activity');
  assert.ok(activity);
  assert.match(activity.activity[0].when, /Aug 2026/);
  assert.doesNotMatch(activity.activity[0].when, /T\d{2}:\d{2}/);
  assert.doesNotMatch(JSON.stringify(recent), /\/v1\//);

  const mean = buildKpiDrilldown('mean', {
    summary: {
      total: 3,
      mean_orientation: 5.1,
      domains: [{ id: 'psychometric', label: 'Psychometric indicators', score: 5.4, n: 3 }],
      items,
      trend: [],
    },
    records,
  });
  assert.match(mean.value, /5\.10 \/ 7/);
  assert.ok(mean.sections.some((section) => section.title.includes('Theme comparison')));
  assert.doesNotMatch(mean.summary, /desk assessment/i);
  assert.doesNotMatch(JSON.stringify(mean), /\/v1\/summary|loaded rows/i);

  const lastIntake = buildKpiDrilldown('last-intake', {
    summary: {
      total: 3,
      last_24h: 1,
      last_intake: '2026-08-12T10:00:00Z',
      items,
      trend: [],
    },
    records,
    geography: [['india', 'India'], ['europe-uk', 'Europe or United Kingdom']],
    roles: [['credit-manager', 'Credit Manager'], ['risk-manager', 'Risk Manager or Risk Analyst']],
  });
  assert.equal(lastIntake.title, 'Latest response');
  assert.equal(lastIntake.value, '12 Aug 2026, 10:00 AM');
  assert.doesNotMatch(lastIntake.value, /T\d{2}:\d{2}/);

  const domain = buildDomainDrilldown('psychometric', {
    summary: {
      domains: [{ id: 'psychometric', label: 'Psychometric indicators', score: 5.4, n: 40 }],
      items,
    },
    records,
    geography: [['india', 'India']],
    roles: [['credit-manager', 'Credit Manager']],
    experience: [['2-5', '2-5 years']],
    itemLabels: { B1: 'High', B2: 'Low', B3: 'Split' },
  });
  assert.equal(domain.title, 'Psychometric indicators');
  assert.match(domain.value, /5\.40 \/ 7/);
  assert.ok(domain.sections.some((section) => section.title === 'Higher-scoring questions'));
  assert.ok(domain.sections.some((section) => section.title === 'Lower-scoring questions'));
  assert.ok(domain.sections.some((section) => section.title === 'More divided questions'));
  assert.ok(domain.sections.some((section) => section.title.includes('Detailed breakdown')));
  assert.ok(domain.sections.some((section) => section.kind === 'note'));
  assert.match(domain.note, /descriptive/i);
  assert.doesNotMatch(domain.summary, /significant|causal|good|bad/i);
  assert.doesNotMatch(JSON.stringify(domain), /contributing|loaded rows|\/v1\//i);
  assert.match(domain.summary, /averages 5\.40/);
});

test('item progressive disclosure stays collapsed by default and shows question text before IDs', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  assert.match(html, /<details class="item-all-details" id="item-all-details">/);
  assert.doesNotMatch(html, /item-all-details"[^>]*open/);
  assert.match(js, /showAllItems = false/);
  assert.match(js, /item-all-details[\s\S]*addEventListener\('toggle'/);
  assert.match(js, /showAllItems = Boolean\(event\.target\.open\)/);
  assert.match(js, /if \(allHost && \(showAllItems \|\| details\?\.open\)\)/);
  assert.match(js, /renderItemDistributionRow/);
  assert.match(js, /highlightCount: 3/);
  assert.match(js, /item-highlight-summary/);
  assert.match(js, /fullDistHtml/);
  assert.match(js, /renderHighlightGroup\('Highest'/);
  assert.match(js, /renderHighlightGroup\('Lowest'/);
  assert.match(js, /renderHighlightGroup\('Most divided'/);
  assert.match(js, /item-question/);
  assert.match(js, /item-id-secondary/);
  assert.match(
    js,
    /item-question[\s\S]{0,180}?item-id item-id-secondary/
  );

  const items = [
    { id: 'B1', counts: [1, 2, 3, 4, 5, 6, 7] },
    { id: 'B2', counts: [7, 6, 5, 4, 3, 2, 1] },
    { id: 'B3', counts: [0, 0, 0, 10, 0, 0, 0] },
  ];
  const ranked = rankItemHighlights(items, { highlightCount: 2 });
  assert.equal(ranked.highest.length, 2);
  assert.equal(ranked.lowest.length, 2);
  assert.equal(ranked.mostDivided.length, 2);
  assert.equal(ranked.all.length, 3);
  assert.deepEqual(
    ranked.all.map((row) => row.id).sort(),
    ['B1', 'B2', 'B3']
  );
});

test('response ledger paginates ten records per page with progressive detail', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  assert.match(html, /Ten records per page/);
  assert.match(html, /id="ledger-prev"/);
  assert.match(html, /id="ledger-next"/);
  assert.match(js, /RESPONSE_PAGE_LIMIT = 10/);
  assert.match(js, /records\.slice\(start, start \+ RESPONSE_PAGE_LIMIT\)/);
  assert.match(js, /toggleRecordDetail/);
  assert.match(js, /record-detail/);
  assert.match(js, /Free-text answers are not shown in the ledger/);
  assert.match(js, /in this view/);
  assert.doesNotMatch(js, /loaded ·/);
});

test('exports and deletions stay disabled in researcher UI source', () => {
  const js = read('researcher/dashboard.js');
  const html = read('researcher/index.html');
  assert.match(js, /LIVE_EXPORTS_ENABLED = false/);
  assert.match(js, /LIVE_DELETIONS_ENABLED = false/);
  assert.doesNotMatch(js, /LIVE_EXPORTS_ENABLED = true/);
  assert.doesNotMatch(js, /LIVE_DELETIONS_ENABLED = true/);
  assert.match(html, /id="export-csv"[^>]*disabled/);
  assert.match(html, /id="delete-submit"[^>]*disabled/);
  assert.match(html, /CSV export is unavailable until it is enabled/);
  assert.match(html, /Deletion is unavailable until it is enabled/);
  assert.match(read('config.js'), /COLLECTION_ENABLED:\s*false/);
});

test('qualitative access boundary remains dedicated-endpoint + reveal checkbox', () => {
  const js = read('researcher/dashboard.js');
  const html = read('researcher/index.html');
  assert.match(html, /id="reveal-reflections"/);
  assert.match(html, /Free-text answers/);
  assert.match(js, /\/v1\/responses\/\$\{encodeURIComponent\(ref\)\}\/qualitative/);
  assert.match(js, /if \(!revealed\)/);
  assert.match(js, /qualitative = \[\]/);
  assert.doesNotMatch(js, /include_qualitative\s*[:=]\s*true/);
  assert.doesNotMatch(html, /id="record-rows"[\s\S]*openResponses/);
  assert.match(js, /buildDomainDrilldown/);
  const drill = read('researcher/drilldowns.mjs');
  assert.match(drill, /gated Free-text answers section/);
  assert.doesNotMatch(drill, /openResponses/);
  assert.doesNotMatch(drill, /\/v1\/summary/);
  assert.doesNotMatch(drill, /dedicated protected qualitative endpoint/);
});

test('researcher-facing drilldown copy keeps security surfaces unchanged', () => {
  const js = read('researcher/dashboard.js');
  const html = read('researcher/index.html');
  assert.match(js, /LIVE_EXPORTS_ENABLED = false/);
  assert.match(js, /LIVE_DELETIONS_ENABLED = false/);
  assert.match(html, /<details class="workspace-panel admin-panel"/);
  assert.match(html, /id="reveal-reflections"/);
  assert.doesNotMatch(html, /COLLECTION_ENABLED:\s*true/);
});

test('drawer hierarchy puts methodology behind deliberate disclosure', () => {
  const js = read('researcher/dashboard.js');
  assert.match(js, /drawer-methodology/);
  assert.match(js, /In plain English/);
  assert.match(js, /Key evidence/);
  assert.match(js, /Detailed breakdown/);
  const plain = js.indexOf('In plain English');
  const evidence = js.indexOf('Key evidence');
  const detailed = js.indexOf("aria-label=\"Detailed breakdown\"");
  const methodology = js.indexOf('drawer-methodology');
  assert.ok(plain > 0 && evidence > plain && detailed > evidence && methodology > detailed);
});
