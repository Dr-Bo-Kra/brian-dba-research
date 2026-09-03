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

test('dashboard IA order and terminology match the approved redesign', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  const css = read('researcher/dashboard.css');

  const overview = html.indexOf('id="overview-title"');
  const participation = html.indexOf('id="participation-title"');
  const domains = html.indexOf('id="compass-title"');
  const items = html.indexOf('id="items-title"');
  const qualitative = html.indexOf('id="reflections-title"');
  const ledger = html.indexOf('id="ledger-title"');
  const admin = html.indexOf('id="admin-title"');
  assert.ok(overview > 0 && participation > overview);
  assert.ok(domains > participation && items > domains);
  assert.ok(qualitative > items && ledger > qualitative && admin > ledger);

  assert.match(html, /DBA Research Dashboard/);
  assert.match(html, /Inclusive Lending Study/);
  assert.match(html, /Mean overall score \(1–7\)/);
  assert.doesNotMatch(html, /Mean orientation/);
  assert.match(html, /participation-panel/);
  assert.match(html, /item-all-details/);
  assert.match(html, /All questions — full distributions/);
  assert.match(html, /admin-panel/);
  assert.match(html, /ledger-meta/);
  assert.match(html, /Overall score/);
  assert.doesNotMatch(html, /significant differences/i);
  assert.doesNotMatch(html, /\bAI\b|theme extraction|auto-generated themes/i);

  assert.match(js, /from '\.\/item-analysis\.mjs'/);
  assert.match(js, /rankItemHighlights/);
  assert.match(js, /RESPONSE_PAGE_LIMIT = 50/);
  assert.match(js, /Showing \$\{records\.length\} of \$\{total\}/);
  assert.match(js, /LIVE_EXPORTS_ENABLED = false/);
  assert.match(js, /LIVE_DELETIONS_ENABLED = false/);
  assert.match(js, /\/v1\/responses\/\$\{encodeURIComponent\(ref\)\}\/qualitative/);
  assert.match(js, /revealBox\?\.checked/);
  assert.doesNotMatch(js, /include_qualitative/);
  assert.doesNotMatch(js, /significant differences/i);

  assert.match(css, /item-highlight/);
  assert.match(css, /admin-panel/);
  assert.match(css, /participation-grid/);
});

test('all-questions expand stays collapsed by default and renders full rows when open', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  assert.match(html, /<details class="item-all-details" id="item-all-details">/);
  assert.doesNotMatch(html, /item-all-details"[^>]*open/);
  assert.match(js, /showAllItems = false/);
  assert.match(js, /item-all-details[\s\S]*addEventListener\('toggle'/);
  assert.match(js, /showAllItems = Boolean\(event\.target\.open\)/);
  assert.match(js, /if \(allHost && \(showAllItems \|\| details\?\.open\)\)/);
  assert.match(js, /renderItemDistributionRow/);

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
  // Full list remains available for expand rendering without dropping items.
  assert.deepEqual(
    ranked.all.map((row) => row.id).sort(),
    ['B1', 'B2', 'B3']
  );
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
});
