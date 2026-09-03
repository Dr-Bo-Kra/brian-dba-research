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
  buildDomainDrilldown,
  buildKpiDrilldown,
  countByField,
  descriptiveDomainInterpretation,
  domainContributingItems,
  DOMAIN_ITEM_IDS,
} from '../researcher/drilldowns.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

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

test('dashboard IA order and progressive disclosure shell match redesign', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  const css = read('researcher/dashboard.css');

  const overview = html.indexOf('id="overview-title"');
  const refine = html.indexOf('id="refine-title"');
  const domains = html.indexOf('id="compass-title"');
  const items = html.indexOf('id="items-title"');
  const ledger = html.indexOf('id="ledger-title"');
  const qualitative = html.indexOf('id="reflections-title"');
  const admin = html.indexOf('id="admin-title"');
  assert.ok(overview > 0 && refine > overview);
  assert.ok(domains > refine && items > domains);
  assert.ok(ledger > items && qualitative > ledger && admin > qualitative);

  assert.match(html, /DBA Research Dashboard/);
  assert.match(html, /Inclusive Lending Study/);
  assert.match(html, /Overall mean score/);
  assert.match(html, /Recent responses/);
  assert.match(html, /data-drill="kpi:accepted"/);
  assert.match(html, /data-drill="kpi:recent"/);
  assert.match(html, /data-drill="kpi:mean"/);
  assert.match(html, /data-drill="kpi:last-intake"/);
  assert.match(html, /id="drill-drawer"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /item-all-details/);
  assert.match(html, /All questions — full distributions/);
  assert.match(html, /admin-panel/);
  assert.match(html, /<details class="workspace-panel admin-panel"/);
  assert.match(html, /ledger-meta/);
  assert.match(html, /ledger-pager/);
  assert.match(html, /Overall score/);
  assert.doesNotMatch(html, /significant differences/i);
  assert.doesNotMatch(html, /\bAI\b|theme extraction|auto-generated themes/i);
  assert.doesNotMatch(html, /participation-panel/);
  assert.doesNotMatch(html, /Board implication|synergy register|EBITDA/i);

  assert.match(js, /from '\.\/item-analysis\.mjs'/);
  assert.match(js, /from '\.\/drilldowns\.mjs'/);
  assert.match(js, /rankItemHighlights/);
  assert.match(js, /buildKpiDrilldown/);
  assert.match(js, /buildDomainDrilldown/);
  assert.match(js, /RESPONSE_PAGE_LIMIT = 10/);
  assert.match(js, /RESPONSE_FETCH_LIMIT = 50/);
  assert.match(js, /openDrilldown/);
  assert.match(js, /closeDrilldown/);
  assert.match(js, /LIVE_EXPORTS_ENABLED = false/);
  assert.match(js, /LIVE_DELETIONS_ENABLED = false/);
  assert.match(js, /\/v1\/responses\/\$\{encodeURIComponent\(ref\)\}\/qualitative/);
  assert.match(js, /revealBox\?\.checked/);
  assert.doesNotMatch(js, /include_qualitative/);
  assert.doesNotMatch(js, /significant differences/i);

  assert.match(css, /item-highlight/);
  assert.match(css, /admin-panel/);
  assert.match(css, /drawer-layer/);
  assert.match(css, /kpi-card/);
  assert.match(css, /ledger-pager/);
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
  assert.match(js, /setAttribute\('aria-label', `Explore/);
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
  assert.match(interpretation, /mean of 5\.25/);
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
  assert.equal(accepted.title, 'Accepted responses');
  assert.equal(accepted.value, '48');
  assert.ok(accepted.sections.some((section) => section.title.includes('Geography')));
  assert.doesNotMatch(JSON.stringify(accepted), /significant|causation|good\/bad|underperform/i);

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
  assert.ok(mean.sections.some((section) => section.title.includes('Domain contribution')));

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
  assert.ok(domain.sections.some((section) => section.title.includes('Strongest')));
  assert.ok(domain.sections.some((section) => section.kind === 'note'));
  assert.match(domain.note, /descriptive/i);
  assert.doesNotMatch(domain.summary, /significant|causal|good|bad/i);
});

test('item progressive disclosure stays collapsed by default', () => {
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
  assert.match(drill, /dedicated protected qualitative endpoint/);
  assert.doesNotMatch(drill, /openResponses/);
});
