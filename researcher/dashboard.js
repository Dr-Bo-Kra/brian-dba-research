import { applyAuthFieldMode, researcherAuthSubmitPath } from './auth-field-mode.mjs';
import { rankItemHighlights } from './item-analysis.mjs';
import {
  buildDomainDrilldown,
  buildKpiDrilldown,
  formatPolarizationLabel,
  formatResearchDate,
  formatResearchDateTime,
  shortenParticipantRef,
} from './drilldowns.mjs';

(function initInquiryArchive() {
  const gate = document.getElementById('auth-gate');
  const workspace = document.getElementById('workspace');
  if (!workspace) return;

  const LEGACY_SESSION_KEY = 'brian-dba-researcher-session';
  const cfg = window.BRIAN_DBA_RESEARCHER_CONFIG || {};
  const endpoint = String(cfg.RESEARCHER_ENDPOINT || '').trim();

  const statusEl = document.getElementById('workspace-status');
  const statusCopy = document.getElementById('status-copy');
  const sessionMeta = document.getElementById('session-meta');
  const signOutBtn = document.getElementById('sign-out');
  const authError = document.getElementById('auth-error');
  const authHint = document.getElementById('auth-hint');
  const authStart = document.getElementById('auth-start');
  const authForm = document.getElementById('auth-form');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const authPasswordStep = document.getElementById('auth-password-step');
  const authMfaStep = document.getElementById('auth-mfa-step');
  const authMfaCode = document.getElementById('auth-mfa-code');
  const authEnroll = document.getElementById('auth-enroll');
  const authQr = document.getElementById('auth-qr');
  applyAuthFieldMode(
    { email: authEmail, password: authPassword, mfaCode: authMfaCode },
    'password'
  );
  const filterForm = document.getElementById('filter-form');
  const revealBox = document.getElementById('reveal-reflections');
  const deleteForm = document.getElementById('delete-form');
  const deleteConfirm = document.getElementById('delete-confirm');
  const deleteSubmit = document.getElementById('delete-submit');
  const deleteError = document.getElementById('delete-error');
  const exportBtn = document.getElementById('export-csv');
  const drillLayer = document.getElementById('drill-layer');
  const drillDrawer = document.getElementById('drill-drawer');
  const drillContent = document.getElementById('drill-content');
  const drillClose = document.getElementById('drill-close');
  const ledgerPrev = document.getElementById('ledger-prev');
  const ledgerNext = document.getElementById('ledger-next');
  const ledgerPager = document.getElementById('ledger-pager');
  const ledgerPageLabel = document.getElementById('ledger-page-label');

  const GEOGRAPHY = [
    ['india', 'India'],
    ['south-asia-other', 'South Asia (excluding India)'],
    ['southeast-asia', 'Southeast Asia'],
    ['east-asia', 'East Asia'],
    ['middle-east', 'Middle East'],
    ['africa', 'Africa'],
    ['europe-uk', 'Europe or United Kingdom'],
    ['north-america', 'North America'],
    ['latin-america-caribbean', 'Latin America or Caribbean'],
    ['oceania', 'Oceania'],
    ['multi-region', 'Multi-region or global role'],
    ['prefer-not', 'Prefer not to say'],
  ];
  const ROLES = [
    ['credit-loan-officer', 'Credit or Loan Officer'],
    ['credit-manager', 'Credit Manager'],
    ['risk-manager', 'Risk Manager or Risk Analyst'],
    ['underwriting', 'Underwriting Specialist'],
    ['branch-manager', 'Branch Manager'],
    ['product-development', 'Product Development Specialist'],
    ['senior-management', 'Senior Management or Executive'],
    ['other', 'Other'],
  ];
  const EXPERIENCE = [
    ['lt2', 'Less than 2 years'],
    ['2-5', '2-5 years'],
    ['6-10', '6-10 years'],
    ['11-15', '11-15 years'],
    ['gt15', 'More than 15 years'],
  ];
  const DOMAINS = [
    { id: 'psychometric', label: 'Psychometric indicators' },
    { id: 'social', label: 'Social capital' },
    { id: 'behavioral', label: 'Behavioral economics' },
    { id: 'readiness', label: 'Organizational readiness' },
    { id: 'inclusiveDecision', label: 'Inclusive decision-making' },
  ];
  const ITEMS = [
    ['B1', 'Financial discipline and loan recommendation'],
    ['B2', 'Repayment commitment'],
    ['B3', 'Responsible financial planning'],
    ['B4', 'Confidence in financial responsibilities'],
    ['B5', 'Psychological characteristics beyond records'],
    ['C6', 'Community reputation'],
    ['C7', 'Peer recommendations'],
    ['C8', 'Community or business groups'],
    ['C9', 'Community trust'],
    ['C10', 'Social relationships beyond records'],
    ['D11', 'Consistent financial decisions'],
    ['D12', 'Avoiding impulsive decisions'],
    ['D13', 'Responsible risk behaviour'],
    ['D14', 'Behavioural information beyond records'],
    ['D15', 'Behavioural characteristics and decision quality'],
    ['E16', 'Leadership support for adoption'],
    ['E17', 'Policies for alternative information'],
    ['E18', 'Technological capability'],
    ['E19', 'Staff training'],
    ['E20', 'Prepared integration with ethics'],
    ['F21', 'Thin-file creditworthy borrowers'],
    ['F22', 'Balance risk and inclusion'],
    ['F23', 'Fairness and ethical responsibility'],
    ['F24', 'Alternative information without lower quality'],
    ['F25', 'More responsible inclusive decisions'],
  ];

  const RESPONSE_FETCH_LIMIT = 50;
  const RESPONSE_PAGE_LIMIT = 10;
  let session = null;
  let pendingTicket = '';
  let records = [];
  let summary = null;
  let qualitative = [];
  let pollTimer = null;
  let showAllItems = false;
  let responsePage = 0;
  let expandedRecordRef = null;
  let drillTrigger = null;
  let previouslyFocused = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function optionLabel(list, value) {
    const hit = list.find((row) => row[0] === value);
    return hit ? hit[1] : value || '—';
  }

  function fillSelect(select, pairs) {
    if (!select) return;
    pairs.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
  }

  function isProtectedResearcherEndpoint(url) {
    if (!url) return false;
    if (url.startsWith('//')) return false;
    if (/^\/api\/researcher\/?$/.test(url)) return true;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.username || parsed.password) return false;
      if (/\/rest\/v1\//i.test(`${parsed.pathname}${parsed.search}`)) return false;
      return true;
    } catch {
      return false;
    }
  }

  const apiConfigured = isProtectedResearcherEndpoint(endpoint);

  function purgeClientSecrets() {
    try {
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      /* ignore */
    }
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('brian-dba-'))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* ignore */
    }
  }

  function setStatus(state, message) {
    if (!statusEl || !statusCopy) return;
    statusEl.dataset.state = state;
    statusCopy.textContent = message;
  }

  function setSessionMeta(expiresAt) {
    if (!sessionMeta) return;
    if (!session) {
      sessionMeta.hidden = true;
      sessionMeta.replaceChildren();
      return;
    }
    sessionMeta.hidden = false;
    const label = document.createElement('span');
    label.className = 'workspace-session-label';
    label.textContent = 'Signed in';
    sessionMeta.replaceChildren(label);
    if (!expiresAt) return;
    const expiry = document.createElement('small');
    expiry.className = 'workspace-session-expiry';
    expiry.textContent = `Ends ${formatWhen(expiresAt)}`;
    sessionMeta.append(expiry);
  }

  function readFilters() {
    const data = new FormData(filterForm);
    return {
      from: String(data.get('from') || ''),
      to: String(data.get('to') || ''),
      region: String(data.get('region') || ''),
      role: String(data.get('role') || ''),
      experience: String(data.get('experience') || ''),
      q: String(data.get('q') || '').trim(),
    };
  }

  function queryString(filters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
  }

  function formatWhen(value) {
    return formatResearchDateTime(value);
  }

  function drillContext() {
    return {
      summary,
      records,
      geography: GEOGRAPHY,
      roles: ROLES,
      experience: EXPERIENCE,
      itemLabels: Object.fromEntries(ITEMS),
    };
  }

  function distBarHeight(count, max, ceiling) {
    const safeCount = Number(count) || 0;
    if (safeCount <= 0) return 0;
    return Math.max(8, Math.round((safeCount / Math.max(max, 1)) * ceiling));
  }

  function miniDistHtml(counts, options = {}) {
    const safe = Array.isArray(counts) ? counts : [0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(...safe, 1);
    const ceiling = Number(options.ceiling) || 40;
    const compact = Boolean(options.compact);
    return `<div class="dist-scale ${compact ? 'dist-scale-spark' : 'dist-scale-mini'}" aria-hidden="true">
      ${safe
        .map((count, index) => {
          const height = distBarHeight(count, max, ceiling);
          const empty = height === 0 ? ' is-empty' : '';
          return `<div class="dist-col${empty}"><i data-count="${count}" style="height:${height}px"></i>${
            compact ? '' : `<span>${index + 1}</span>`
          }</div>`;
        })
        .join('')}
    </div>`;
  }

  function fullDistHtml(counts, itemId) {
    const safe = Array.isArray(counts) ? counts : [0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(...safe, 1);
    const total = safe.reduce((sum, value) => sum + value, 0) || 1;
    return `<div class="dist-scale dist-scale-full" aria-label="${escapeHtml(itemId || '')} distribution">
      ${safe
        .map((count, index) => {
          const height = distBarHeight(count, max, 72);
          const share = Math.round((count / total) * 100);
          const empty = height === 0 ? ' is-empty' : '';
          return `<div class="dist-col${empty}" title="${count} · ${share}%">
            <i data-count="${count}" style="height:${height}px"></i>
            <span>${index + 1}</span>
            <em>${count}</em>
          </div>`;
        })
        .join('')}
    </div>`;
  }

  function itemMetaLine(item) {
    const parts = [
      `mean ${item.mean == null ? '—' : Number(item.mean).toFixed(2)} / 7`,
      `n = ${item.n ?? 0}`,
    ];
    const polarization = formatPolarizationLabel(item.polarization);
    if (polarization) parts.push(polarization);
    return parts.join(' · ');
  }

  function renderDrawerRows(rows) {
    if (!rows?.length) return '<p class="empty-copy">No detail rows for this view.</p>';
    return `<div class="drawer-rows">${rows
      .map(
        ([label, value]) =>
          `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`
      )
      .join('')}</div>`;
  }

  function renderDrawerBars(bars, valueSuffix = '') {
    if (!bars?.length) return '<p class="empty-copy">No composition detail for this view.</p>';
    return `<div class="drawer-bars">${bars
      .map((bar) => {
        const label = escapeHtml(bar.label || '');
        const count = Number(bar.count) || 0;
        const share = Math.max(0, Math.min(100, Number(bar.share) || 0));
        const meta = bar.meta ? ` · ${escapeHtml(bar.meta)}` : '';
        const display =
          valueSuffix && Number.isFinite(Number(bar.count))
            ? `${Number(bar.count).toFixed(2)}${escapeHtml(valueSuffix)}`
            : String(count);
        return `<div class="drawer-bar-row">
          <div class="drawer-bar-label"><span>${label}</span><b>${display}${meta}</b></div>
          <div class="drawer-bar-track" aria-hidden="true"><i style="width:${share}%"></i></div>
        </div>`;
      })
      .join('')}</div>`;
  }

  function renderDrawerActivity(activity) {
    if (!activity?.length) return '<p class="empty-copy">No recent activity in this view.</p>';
    return `<ol class="drawer-activity">${activity
      .map((row) => {
        const score = row.score ? ` · ${escapeHtml(row.score)}` : '';
        return `<li>
          <strong>${escapeHtml(row.when || '—')}</strong>
          <span>${escapeHtml(row.role || '—')} · ${escapeHtml(row.geography || '—')}${score}</span>
          <small>${escapeHtml(row.reference || '—')}</small>
        </li>`;
      })
      .join('')}</ol>`;
  }

  function renderDrawerItems(items) {
    if (!items?.length) return '<p class="empty-copy">No items in the current filter.</p>';
    return items
      .map(
        (item) => `<details class="drawer-item">
          <summary>
            <span class="item-id">${escapeHtml(item.id)}</span>
            <span class="drawer-item-label">${escapeHtml(item.label || '')}</span>
            <span class="item-highlight-meta">${escapeHtml(itemMetaLine(item))}</span>
            ${miniDistHtml(item.counts, { compact: true, ceiling: 28 })}
          </summary>
          ${fullDistHtml(item.counts, item.id)}
        </details>`
      )
      .join('');
  }

  function renderDrawerDetails(section) {
    const summaryLabel = escapeHtml(section.summaryLabel || 'Show more detail');
    if (section.distributionItems?.length) {
      return `<details class="drawer-progressive">
        <summary>${summaryLabel}</summary>
        <div class="drawer-progressive-body">
          ${section.distributionItems
            .map(
              (item) => `<div class="drawer-item is-static">
                <p><span class="item-id">${escapeHtml(item.id)}</span> ${escapeHtml(
                item.label || ''
              )}</p>
                <p class="item-highlight-meta">${escapeHtml(itemMetaLine(item))}</p>
                ${fullDistHtml(item.counts, item.id)}
              </div>`
            )
            .join('')}
        </div>
      </details>`;
    }
    const groups = section.groups || [];
    if (!groups.length && section.rows?.length) {
      return `<details class="drawer-progressive">
        <summary>${summaryLabel}</summary>
        <div class="drawer-progressive-body">${renderDrawerRows(section.rows)}</div>
      </details>`;
    }
    return `<details class="drawer-progressive">
      <summary>${summaryLabel}</summary>
      <div class="drawer-progressive-body">
        ${groups
          .map(
            (group) => `<section class="drawer-subsection">
              <h4>${escapeHtml(group.title || '')}</h4>
              ${renderDrawerRows(group.rows || [])}
            </section>`
          )
          .join('')}
      </div>
    </details>`;
  }

  function renderDrilldown(detail) {
    if (!drillContent || !detail) return;
    const observations = detail.observations || detail.rows || [];
    const sections = (detail.sections || [])
      .map((section) => {
        if (section.kind === 'note') {
          return `<div class="drawer-callout"><small>${escapeHtml(
            section.title || 'Note'
          )}</small><p>${escapeHtml(section.note || '')}</p></div>`;
        }
        if (section.kind === 'items') {
          return `<section class="drawer-section" aria-label="${escapeHtml(section.title)}">
            <h3>${escapeHtml(section.title)}</h3>
            ${renderDrawerItems(section.items || [])}
          </section>`;
        }
        if (section.kind === 'distribution') {
          return `<section class="drawer-section" aria-label="${escapeHtml(section.title)}">
            <h3>${escapeHtml(section.title)}</h3>
            ${(section.items || [])
              .map(
                (item) => `<div class="drawer-item is-static">
                  <p><span class="item-id">${escapeHtml(item.id)}</span> ${escapeHtml(
                  item.label || ''
                )}</p>
                  ${fullDistHtml(item.counts, item.id)}
                </div>`
              )
              .join('')}
          </section>`;
        }
        if (section.kind === 'bars') {
          return `<section class="drawer-section" aria-label="${escapeHtml(section.title)}">
            <h3>${escapeHtml(section.title)}</h3>
            ${renderDrawerBars(section.bars || [], section.valueSuffix || '')}
          </section>`;
        }
        if (section.kind === 'activity') {
          return `<section class="drawer-section" aria-label="${escapeHtml(section.title)}">
            <h3>${escapeHtml(section.title)}</h3>
            ${renderDrawerActivity(section.activity || [])}
          </section>`;
        }
        if (section.kind === 'details') {
          return `<section class="drawer-section" aria-label="${escapeHtml(section.title)}">
            <h3>${escapeHtml(section.title)}</h3>
            ${renderDrawerDetails(section)}
          </section>`;
        }
        return `<section class="drawer-section" aria-label="${escapeHtml(section.title)}">
          <h3>${escapeHtml(section.title)}</h3>
          ${renderDrawerRows(section.rows || [])}
        </section>`;
      })
      .join('');
    drillContent.innerHTML = `
      <div class="drawer-head">
        <small>${escapeHtml(detail.eyebrow || '')}</small>
        <h2 id="drawer-title">${escapeHtml(detail.title || 'Detail')}</h2>
        <strong>${escapeHtml(detail.value || '—')}</strong>
      </div>
      <section class="drawer-section drawer-tell" aria-label="What this tells us">
        <h3>What this tells us</h3>
        <p>${escapeHtml(detail.summary || '')}</p>
      </section>
      <section class="drawer-section" aria-label="Key observations">
        <h3>Key observations</h3>
        ${renderDrawerRows(observations)}
      </section>
      <section class="drawer-evidence" aria-label="Supporting evidence">
        <h3 class="drawer-evidence-title">Supporting evidence</h3>
        ${sections}
      </section>
      <div class="drawer-source"><strong>Methodological context</strong> ${escapeHtml(
        detail.note || ''
      )}</div>`;
  }

  function getFocusable(container) {
    if (!container) return [];
    return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
    );
  }

  function closeDrilldown() {
    if (!drillLayer || drillLayer.hidden) return;
    drillLayer.hidden = true;
    document.body.classList.remove('drawer-open');
    if (drillContent) drillContent.innerHTML = '';
    const restore = drillTrigger || previouslyFocused;
    drillTrigger = null;
    previouslyFocused = null;
    if (restore && typeof restore.focus === 'function') restore.focus();
  }

  function openDrilldown(detail, trigger) {
    if (!drillLayer || !drillDrawer || !detail) return;
    previouslyFocused = document.activeElement;
    drillTrigger = trigger || previouslyFocused;
    renderDrilldown(detail);
    drillLayer.hidden = false;
    document.body.classList.add('drawer-open');
    window.setTimeout(() => {
      (drillClose || drillDrawer).focus();
    }, 0);
  }

  function openDrillFromTarget(target) {
    const trigger = target?.closest?.('[data-drill]');
    if (!trigger) return;
    const key = String(trigger.getAttribute('data-drill') || '');
    const [kind, id] = key.split(':');
    if (kind === 'kpi') {
      openDrilldown(buildKpiDrilldown(id, drillContext()), trigger);
      return;
    }
    if (kind === 'domain') {
      openDrilldown(buildDomainDrilldown(id, drillContext()), trigger);
    }
  }

  function renderGlance() {
    const total = summary?.total ?? 0;
    document.getElementById('kpi-count').textContent = String(total);
    document.getElementById('kpi-recent').textContent = String(summary?.last_24h ?? 0);
    const meanEl = document.getElementById('kpi-orientation');
    if (summary?.mean_orientation != null) {
      meanEl.textContent = `${Number(summary.mean_orientation).toFixed(2)} / 7`;
    } else {
      meanEl.textContent = '—';
    }
    document.getElementById('kpi-updated').textContent = summary?.last_intake
      ? formatResearchDate(summary.last_intake)
      : '—';
  }

  function renderDomains() {
    const host = document.getElementById('domain-scores');
    const empty = document.getElementById('domain-empty');
    host.innerHTML = '';
    const stats = summary?.domains || [];
    const any = stats.some((stat) => stat.score != null);
    empty.hidden = any;
    if (!any) return;
    const byId = new Map(stats.map((stat) => [stat.id, stat]));
    DOMAINS.forEach((domain) => {
      const stat = byId.get(domain.id);
      if (!stat || stat.score == null) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'domain-score drill';
      button.setAttribute('data-drill', `domain:${domain.id}`);
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'drill-drawer');
      button.setAttribute('aria-label', `Explore ${stat.label || domain.label}`);
      const percent = Math.round((Number(stat.score) / 7) * 100);
      const n = Number(stat.n) || 0;
      button.innerHTML = `
        <div class="domain-score-head">
          <strong>${escapeHtml(stat.label || domain.label)}</strong>
          <span>${Number(stat.score).toFixed(2)} / 7</span>
        </div>
        <div class="domain-bar" aria-hidden="true"><i></i></div>
        <p><strong class="domain-n">n = ${n}</strong> · mean on the survey 1–7 scale for accepted rating sets in the current filter.</p>
        <i class="drill-mark" aria-hidden="true">+</i>`;
      host.append(button);
      const bar = button.querySelector('.domain-bar > i');
      if (bar) bar.style.width = `${percent}%`;
    });
  }

  function shortItemLabel(label) {
    const text = String(label || '').trim();
    if (text.length <= 42) return text;
    return `${text.slice(0, 40)}…`;
  }

  function renderHighlightGroup(title, rows) {
    if (!rows.length) return '';
    return `<div class="item-highlight-group">
      <h3>${escapeHtml(title)}</h3>
      <ul class="item-highlight-list">
        ${rows
          .map(
            (row) => `<li>
              <details class="item-highlight">
                <summary class="item-highlight-summary">
                  <span class="item-highlight-copy">
                    <span class="item-id">${escapeHtml(row.id)}</span>
                    ${escapeHtml(shortItemLabel(row.label))}
                  </span>
                  <span class="item-highlight-meta">mean ${Number(row.mean).toFixed(2)} / 7</span>
                  ${miniDistHtml(row.counts, { compact: true, ceiling: 24 })}
                </summary>
                <div class="item-highlight-expand">
                  <p class="item-highlight-meta">${escapeHtml(itemMetaLine(row))}</p>
                  ${fullDistHtml(row.counts, row.id)}
                </div>
              </details>
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
  }

  function renderItemDistributionRow(item, labels) {
    const counts = Array.isArray(item.counts) ? item.counts : [0, 0, 0, 0, 0, 0, 0];
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<p><span class="item-id">${escapeHtml(item.id)}</span> ${escapeHtml(
      labels[item.id] || ''
    )}</p>
      ${fullDistHtml(counts, item.id)}`;
    return row;
  }

  function renderItems() {
    const host = document.getElementById('item-highlights');
    const empty = document.getElementById('items-empty');
    const allHost = document.getElementById('item-distributions');
    const details = document.getElementById('item-all-details');
    if (host) host.innerHTML = '';
    if (allHost) allHost.innerHTML = '';
    const items = summary?.items || [];
    if (empty) empty.hidden = items.length > 0;
    if (!items.length) {
      if (details) details.hidden = true;
      return;
    }
    if (details) details.hidden = false;
    const labels = Object.fromEntries(ITEMS);
    const ranked = rankItemHighlights(items, { labels, highlightCount: 3 });
    if (host) {
      host.innerHTML =
        renderHighlightGroup('Highest', ranked.highest) +
        renderHighlightGroup('Lowest', ranked.lowest) +
        renderHighlightGroup('Most divided', ranked.mostDivided);
    }
    if (allHost && (showAllItems || details?.open)) {
      items.forEach((item) => {
        allHost.append(renderItemDistributionRow(item, labels));
      });
    }
  }

  function pageCount() {
    return Math.max(1, Math.ceil(records.length / RESPONSE_PAGE_LIMIT) || 1);
  }

  function renderLedger() {
    const body = document.getElementById('record-rows');
    const empty = document.getElementById('ledger-empty');
    const meta = document.getElementById('ledger-meta');
    body.innerHTML = '';
    empty.hidden = records.length > 0;
    const total = summary?.total ?? records.length;
    const pages = pageCount();
    if (responsePage >= pages) responsePage = Math.max(0, pages - 1);
    const start = responsePage * RESPONSE_PAGE_LIMIT;
    const pageRows = records.slice(start, start + RESPONSE_PAGE_LIMIT);
    if (meta) {
      if (records.length || total) {
        meta.hidden = false;
        const shownStart = records.length ? start + 1 : 0;
        const shownEnd = start + pageRows.length;
        meta.textContent = `Showing ${shownStart}–${shownEnd} of ${records.length} in this view · ${total} accepted in filter`;
      } else {
        meta.hidden = true;
        meta.textContent = '';
      }
    }
    if (ledgerPager) {
      ledgerPager.hidden = records.length <= RESPONSE_PAGE_LIMIT;
      if (ledgerPageLabel) {
        ledgerPageLabel.textContent = `Page ${responsePage + 1} of ${pages}`;
      }
      if (ledgerPrev) ledgerPrev.disabled = responsePage <= 0;
      if (ledgerNext) ledgerNext.disabled = responsePage >= pages - 1;
    }
    pageRows.forEach((row) => {
      const ref = row.participant_reference || '';
      const tr = document.createElement('tr');
      tr.className = 'record-row';
      tr.tabIndex = 0;
      tr.setAttribute('aria-expanded', expandedRecordRef === ref ? 'true' : 'false');
      tr.dataset.reference = ref;
      tr.innerHTML = `
        <td><span class="ref-secondary" title="${escapeHtml(ref || '')}">${escapeHtml(
        shortenParticipantRef(ref)
      )}</span></td>
        <td>${escapeHtml(formatWhen(row.accepted_at))}</td>
        <td>${escapeHtml(optionLabel(GEOGRAPHY, row.region))}</td>
        <td>${escapeHtml(optionLabel(ROLES, row.role))}</td>
        <td>${escapeHtml(optionLabel(EXPERIENCE, row.experience))}</td>
        <td>${escapeHtml(
          row.orientation != null ? `${Number(row.orientation).toFixed(2)} / 7` : '—'
        )}</td>`;
      body.append(tr);
      if (expandedRecordRef === ref) {
        const detail = document.createElement('tr');
        detail.className = 'record-detail-row';
        detail.innerHTML = `<td colspan="6"><div class="record-detail">
          <p><strong>Record detail</strong> · ${escapeHtml(ref || '—')}</p>
          <p>Accepted ${escapeHtml(formatWhen(row.accepted_at))} · ${escapeHtml(
          optionLabel(GEOGRAPHY, row.region)
        )} · ${escapeHtml(optionLabel(ROLES, row.role))} · ${escapeHtml(
          optionLabel(EXPERIENCE, row.experience)
        )}</p>
          <p>Overall score ${escapeHtml(
            row.orientation != null ? `${Number(row.orientation).toFixed(2)} / 7` : '—'
          )} · Legal hold ${row.legal_hold ? 'yes' : 'no'} · Anonymised ${
          row.anonymised ? 'yes' : 'no'
        }</p>
          <p>Free-text answers are not shown in the ledger. Use the gated Free-text answers section after an explicit researcher action.</p>
        </div></td>`;
        body.append(detail);
      }
    });
    if (exportBtn) exportBtn.disabled = true;
  }

  function toggleRecordDetail(reference) {
    expandedRecordRef = expandedRecordRef === reference ? null : reference;
    renderLedger();
  }

  function renderReflections() {
    const host = document.getElementById('reflection-list');
    const empty = document.getElementById('reflection-empty');
    host.innerHTML = '';
    const revealed = Boolean(revealBox?.checked);
    host.hidden = !revealed;
    if (!revealed) {
      empty.textContent = 'Leave this off unless you need to read free-text answers.';
      empty.hidden = false;
      qualitative = [];
      return;
    }
    if (!session || !apiConfigured) {
      empty.textContent = 'No free-text answers in the current view.';
      empty.hidden = false;
      return;
    }
    empty.hidden = qualitative.length > 0;
    empty.textContent = 'No free-text answers in the current view.';
    qualitative.forEach((entry) => {
      const article = document.createElement('article');
      article.className = 'reflection-card';
      const opens = entry.qualitative?.openResponses || {};
      const answers = Object.entries(opens)
        .map(([id, text]) => `<p><strong>${escapeHtml(id)}.</strong> ${escapeHtml(text)}</p>`)
        .join('');
      article.innerHTML = `
        <h3>${escapeHtml(entry.participant_reference || 'Record')}</h3>
        ${entry.qualitative?.roleDescription ? `<p>${escapeHtml(entry.qualitative.roleDescription)}</p>` : ''}
        ${answers}`;
      host.append(article);
    });
  }

  function renderAll() {
    renderGlance();
    renderDomains();
    renderItems();
    renderLedger();
    renderReflections();
  }

  function clearWorkspaceData() {
    session = null;
    pendingTicket = '';
    records = [];
    summary = null;
    qualitative = [];
    showAllItems = false;
    responsePage = 0;
    expandedRecordRef = null;
    closeDrilldown();
    if (signOutBtn) signOutBtn.hidden = true;
    setSessionMeta(null);
    if (exportBtn) exportBtn.disabled = true;
    if (deleteSubmit) deleteSubmit.disabled = true;
  }

  function apiUrl(path) {
    return `${endpoint.replace(/\/$/, '')}${path}`;
  }

  async function researcherFetch(path, options = {}) {
    if (!apiConfigured || !session) {
      const error = new Error('disconnected');
      error.code = 'disconnected';
      throw error;
    }
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(apiUrl(path), {
      ...options,
      headers,
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (response.status === 401 || response.status === 403) {
      clearWorkspaceData();
      const error = new Error('session-expired');
      error.code = 'session-expired';
      throw error;
    }
    if (!response.ok) {
      const error = new Error('http');
      error.code = response.status === 503 ? 'unavailable' : 'http';
      throw error;
    }
    return response;
  }

  function listQueryString(filters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('limit', String(RESPONSE_FETCH_LIMIT));
    return `?${params.toString()}`;
  }

  async function refreshWorkspace() {
    if (!apiConfigured || !session) {
      records = [];
      summary = null;
      qualitative = [];
      renderAll();
      return;
    }
    setStatus('loading', 'Updating…');
    try {
      const filters = readFilters();
      const summaryQs = queryString(filters);
      const listQs = listQueryString(filters);
      const [summaryRes, listRes] = await Promise.all([
        researcherFetch(`/v1/summary${summaryQs}`, { method: 'GET' }),
        researcherFetch(`/v1/responses${listQs}`, { method: 'GET' }),
      ]);
      summary = await summaryRes.json();
      const payload = await listRes.json();
      records = Array.isArray(payload?.records) ? payload.records : [];
      responsePage = 0;
      expandedRecordRef = null;
      setStatus('live', 'Live');
      setSessionMeta(session?.expiresAt);
      if (revealBox?.checked) await loadQualitative();
      renderAll();
    } catch (error) {
      records = [];
      summary = null;
      qualitative = [];
      renderAll();
      if (error.code === 'session-expired') {
        showAuth('Your session ended. Sign in again.');
        setStatus('error', 'Your session ended. Sign in again.');
        return;
      }
      setStatus('error', 'Could not refresh the workspace.');
    }
  }

  async function loadQualitative() {
    qualitative = [];
    if (!session || !apiConfigured || !revealBox?.checked) return;
    const refs = records
      .map((row) => row.participant_reference)
      .filter((ref) => /^resp_[0-9a-f-]{32,36}$/i.test(ref))
      .slice(0, 50);
    for (const ref of refs) {
      try {
        const response = await researcherFetch(`/v1/responses/${encodeURIComponent(ref)}/qualitative`, {
          method: 'GET',
        });
        qualitative.push(await response.json());
      } catch {
        break;
      }
    }
  }

  function stopPolling() {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    if (!apiConfigured || !session) return;
    pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
        clearWorkspaceData();
        showAuth('Your session ended. Sign in again.');
        return;
      }
      void refreshWorkspace();
    }, 30000);
  }

  function showPasswordStep() {
    pendingTicket = '';
    if (authPasswordStep) authPasswordStep.hidden = false;
    if (authMfaStep) authMfaStep.hidden = true;
    if (authEnroll) authEnroll.hidden = true;
    if (authQr) {
      authQr.hidden = true;
      authQr.removeAttribute('src');
    }
    if (authMfaCode) authMfaCode.value = '';
    if (authPassword) authPassword.value = '';
    applyAuthFieldMode(
      { email: authEmail, password: authPassword, mfaCode: authMfaCode },
      'password'
    );
  }

  function showMfaStep({ enrollmentRequired, qr }) {
    if (authPasswordStep) authPasswordStep.hidden = true;
    if (authMfaStep) authMfaStep.hidden = false;
    if (authPassword) authPassword.value = '';
    if (authMfaCode) authMfaCode.value = '';
    applyAuthFieldMode(
      { email: authEmail, password: authPassword, mfaCode: authMfaCode },
      'mfa'
    );
    const canShowQr = Boolean(enrollmentRequired && qr && String(qr).startsWith('data:image/'));
    if (authEnroll) authEnroll.hidden = !canShowQr;
    if (authQr) {
      if (canShowQr) {
        authQr.src = qr;
        authQr.hidden = false;
      } else {
        authQr.hidden = true;
        authQr.removeAttribute('src');
      }
    }
  }

  function applySessionPayload(payload) {
    if (payload?.authenticated !== true) return false;
    if (payload?.mfaRequired) return false;
    session = {
      role: payload.role || 'authorised_researcher',
      expiresAt: payload.expiresAt,
      csrfToken: payload.csrfToken,
    };
    showWorkspace();
    startPolling();
    void refreshWorkspace();
    return true;
  }

  async function authPost(path, body) {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    return { response, payload };
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!apiConfigured) return;
    if (authError) {
      authError.hidden = true;
      authError.textContent = '';
    }
    try {
      if (researcherAuthSubmitPath(authMfaStep?.hidden) === '/v1/session/mfa') {
        const { response, payload } = await authPost('/v1/session/mfa', {
          ticket: pendingTicket,
          code: String(authMfaCode?.value || ''),
        });
        if (payload?.authenticated === true && !payload?.mfaRequired) {
          pendingTicket = '';
          applySessionPayload(payload);
          return;
        }
        if (authError) {
          authError.hidden = false;
          authError.textContent =
            response.status === 503
              ? 'Sign-in is unavailable until authentication is configured.'
              : 'That authenticator code could not be verified.';
        }
        return;
      }
      const { response, payload } = await authPost('/v1/session/login', {
        email: String(authEmail?.value || '').trim(),
        password: String(authPassword?.value || ''),
      });
      if (payload?.mfaRequired) {
        pendingTicket = String(payload.ticket || '');
        showMfaStep({ enrollmentRequired: payload.enrollmentRequired, qr: payload.qr });
        return;
      }
      if (payload?.authenticated === true) {
        applySessionPayload(payload);
        return;
      }
      if (authError) {
        authError.hidden = false;
        authError.textContent =
          response.status === 503
            ? 'Sign-in is unavailable until authentication is configured.'
            : 'Sign-in was refused.';
      }
    } catch {
      if (authError) {
        authError.hidden = false;
        authError.textContent = 'Sign-in is unavailable.';
      }
    }
  }

  function showAuth(message) {
    stopPolling();
    workspace.hidden = true;
    gate.hidden = false;
    showPasswordStep();
    if (authError) {
      authError.hidden = !message;
      authError.textContent = message || '';
    }
    if (authStart) authStart.disabled = !apiConfigured;
    if (authHint) authHint.textContent = 'There is no mock login.';
  }

  function showWorkspace() {
    gate.hidden = true;
    workspace.hidden = false;
    if (signOutBtn) signOutBtn.hidden = !session;
    setSessionMeta(session?.expiresAt);
    renderAll();
  }

  function showDisconnectedWorkspace() {
    clearWorkspaceData();
    gate.hidden = true;
    workspace.hidden = false;
    setStatus('disconnected', 'This workspace is unavailable.');
    renderAll();
  }

  async function restoreSession() {
    if (!apiConfigured) return null;
    try {
      const response = await fetch(apiUrl('/v1/session'), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload?.authenticated !== true) return null;
      return {
        role: payload.role || 'authorised_researcher',
        expiresAt: payload.expiresAt,
        csrfToken: payload.csrfToken,
      };
    } catch {
      return null;
    }
  }

  async function handleSignOut() {
    stopPolling();
    try {
      if (apiConfigured && session) {
        await fetch(apiUrl('/v1/session/logout'), {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {},
        });
      }
    } catch {
      /* ignore */
    }
    clearWorkspaceData();
    if (apiConfigured) showAuth('You signed out of the inquiry archive.');
    else showDisconnectedWorkspace();
  }

  async function handleDelete(event) {
    event.preventDefault();
    if (deleteError) {
      deleteError.hidden = true;
      deleteError.textContent = '';
    }
    const LIVE_DELETIONS_ENABLED = false;
    if (!LIVE_DELETIONS_ENABLED || !session || !apiConfigured) {
      if (deleteError) {
        deleteError.hidden = false;
        deleteError.textContent = 'Deletion is unavailable until it is enabled for this study.';
      }
      return;
    }
    const reference = String(document.getElementById('delete-reference')?.value || '').trim();
    if (!/^resp_[0-9a-f-]{32,36}$/i.test(reference) || !deleteConfirm?.checked) {
      if (deleteError) {
        deleteError.hidden = false;
        deleteError.textContent = 'Enter a valid participant reference and confirm the deletion.';
      }
      return;
    }
    try {
      await researcherFetch('/v1/deletions', {
        method: 'POST',
        body: JSON.stringify({ reference, confirm: true }),
      });
      document.getElementById('delete-reference').value = '';
      deleteConfirm.checked = false;
      deleteSubmit.disabled = true;
      await refreshWorkspace();
    } catch {
      if (deleteError) {
        deleteError.hidden = false;
        deleteError.textContent = 'Deletion is unavailable until it is enabled for this study.';
      }
    }
  }

  async function handleExport() {
    const LIVE_EXPORTS_ENABLED = false;
    if (!LIVE_EXPORTS_ENABLED || !session || !apiConfigured) {
      setStatus('error', 'CSV export is unavailable until it is enabled for this study.');
      return;
    }
    try {
      const response = await researcherFetch('/v1/exports', {
        method: 'POST',
        body: JSON.stringify({ ...readFilters(), confirm: true }),
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'inquiry-archive-export.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus('error', 'CSV export is unavailable until it is enabled for this study.');
    }
  }

  fillSelect(document.getElementById('filter-region'), GEOGRAPHY);
  fillSelect(document.getElementById('filter-role'), ROLES);
  fillSelect(document.getElementById('filter-experience'), EXPERIENCE);
  purgeClientSecrets();

  authForm?.addEventListener('submit', (event) => void handleAuthSubmit(event));
  filterForm?.addEventListener('submit', (event) => event.preventDefault());
  filterForm?.addEventListener('change', () => {
    if (session && apiConfigured) void refreshWorkspace();
    else renderAll();
  });
  revealBox?.addEventListener('change', () => {
    if (revealBox.checked && session && apiConfigured) {
      void loadQualitative().then(() => renderReflections());
    } else {
      qualitative = [];
      renderReflections();
    }
  });
  deleteForm?.addEventListener('submit', handleDelete);
  deleteConfirm?.addEventListener('change', () => {
    // Deletion remains disabled until LIVE_DELETIONS_ENABLED is turned on.
    deleteSubmit.disabled = true;
  });
  exportBtn?.addEventListener('click', () => void handleExport());
  signOutBtn?.addEventListener('click', () => void handleSignOut());
  document.getElementById('item-all-details')?.addEventListener('toggle', (event) => {
    showAllItems = Boolean(event.target.open);
    renderItems();
  });
  ledgerPrev?.addEventListener('click', () => {
    if (responsePage <= 0) return;
    responsePage -= 1;
    expandedRecordRef = null;
    renderLedger();
  });
  ledgerNext?.addEventListener('click', () => {
    if (responsePage >= pageCount() - 1) return;
    responsePage += 1;
    expandedRecordRef = null;
    renderLedger();
  });
  document.getElementById('record-rows')?.addEventListener('click', (event) => {
    const row = event.target.closest('tr.record-row');
    if (!row) return;
    toggleRecordDetail(row.dataset.reference || '');
  });
  document.getElementById('record-rows')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr.record-row');
    if (!row) return;
    event.preventDefault();
    toggleRecordDetail(row.dataset.reference || '');
  });
  workspace.addEventListener('click', (event) => {
    openDrillFromTarget(event.target);
  });
  drillClose?.addEventListener('click', () => closeDrilldown());
  drillLayer?.addEventListener('mousedown', (event) => {
    if (event.target === drillLayer) closeDrilldown();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drillLayer && !drillLayer.hidden) {
      event.preventDefault();
      closeDrilldown();
      return;
    }
    if (event.key !== 'Tab' || !drillLayer || drillLayer.hidden || !drillDrawer) return;
    const focusable = getFocusable(drillDrawer);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (!apiConfigured) {
    showDisconnectedWorkspace();
    return;
  }

  void restoreSession().then((restored) => {
    if (restored) {
      session = restored;
      showWorkspace();
      startPolling();
      void refreshWorkspace();
    } else {
      showAuth('');
    }
  });
})();
