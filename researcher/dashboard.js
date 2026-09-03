import { applyAuthFieldMode, researcherAuthSubmitPath } from './auth-field-mode.mjs';
import { rankItemHighlights } from './item-analysis.mjs';

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

  const RESPONSE_PAGE_LIMIT = 50;
  let session = null;
  let pendingTicket = '';
  let records = [];
  let summary = null;
  let qualitative = [];
  let pollTimer = null;
  let showAllItems = false;

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
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
      ? new Date(summary.last_intake).toLocaleDateString()
      : '—';
  }

  function renderIntake() {
    const list = document.getElementById('intake-list');
    const empty = document.getElementById('intake-empty');
    list.innerHTML = '';
    const recent = records.slice(0, 8);
    empty.hidden = recent.length > 0;
    recent.forEach((row) => {
      const item = document.createElement('li');
      item.innerHTML = `
        <span class="intake-mark" aria-hidden="true"></span>
        <span>${escapeHtml(optionLabel(ROLES, row.role))} · ${escapeHtml(
        optionLabel(GEOGRAPHY, row.region)
      )}</span>
        <time datetime="${escapeHtml(row.accepted_at || '')}">${escapeHtml(
        formatWhen(row.accepted_at)
      )}</time>`;
      list.append(item);
    });
  }

  function renderTrend() {
    const host = document.getElementById('trend-chart');
    const days = summary?.trend || [];
    if (!days.length) {
      host.innerHTML =
        '<p class="empty-copy">No daily counts yet.</p>';
      return;
    }
    const width = 560;
    const height = 220;
    const pad = 28;
    const max = Math.max(...days.map((day) => Number(day.count) || 0), 1);
    const points = days.map((day, index) => {
      const x = pad + (index * (width - pad * 2)) / Math.max(days.length - 1, 1);
      const y = height - pad - ((Number(day.count) || 0) / max) * (height - pad * 2);
      return { x, y, day: day.day, count: day.count };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
    const area = `${pad},${height - pad} ${polyline} ${points.at(-1).x},${height - pad}`;
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Accepted responses by day">
      <line class="trend-grid" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
      <polygon class="trend-area" points="${area}"></polygon>
      <polyline class="trend-line" points="${polyline}"></polyline>
      ${points
        .map(
          (point) =>
            `<circle class="trend-point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(
              String(point.day)
            )}: ${escapeHtml(String(point.count))}</title></circle>`
        )
        .join('')}
      <text class="trend-label" x="${pad}" y="${height - 8}">${escapeHtml(String(days[0].day))}</text>
      <text class="trend-label" x="${width - pad}" y="${height - 8}" text-anchor="end">${escapeHtml(
      String(days.at(-1).day)
    )}</text>
    </svg>`;
  }

  function renderDomains() {
    const host = document.getElementById('domain-scores');
    const empty = document.getElementById('domain-empty');
    host.innerHTML = '';
    const stats = summary?.domains || [];
    const any = stats.some((stat) => stat.score != null);
    empty.hidden = any;
    if (!any) return;
    stats.forEach((stat) => {
      const article = document.createElement('article');
      article.className = 'domain-score';
      const percent = stat.score == null ? 0 : Math.round((stat.score / 7) * 100);
      const n = Number(stat.n) || 0;
      article.innerHTML = `
        <div class="domain-score-head">
          <strong>${escapeHtml(stat.label || stat.id)}</strong>
          <span>${stat.score == null ? '—' : Number(stat.score).toFixed(2) + ' / 7'}</span>
        </div>
        <div class="domain-bar" aria-hidden="true"><i></i></div>
        <p><strong class="domain-n">n = ${n}</strong> · mean on the survey 1–7 scale for accepted rating sets in the current filter.</p>`;
      host.append(article);
      const bar = article.querySelector('.domain-bar > i');
      if (bar) bar.style.width = `${percent}%`;
    });
  }

  function miniDistHtml(counts) {
    const max = Math.max(...counts, 1);
    return `<div class="dist-scale dist-scale-mini" aria-hidden="true">
      ${counts
        .map(
          (count, index) =>
            `<div class="dist-col"><i data-count="${count}" style="height:${Math.max(
              4,
              (count / max) * 36
            )}px"></i><span>${index + 1}</span></div>`
        )
        .join('')}
    </div>`;
  }

  function renderHighlightGroup(title, rows) {
    if (!rows.length) return '';
    return `<div class="item-highlight-group">
      <h3>${escapeHtml(title)}</h3>
      <ul class="item-highlight-list">
        ${rows
          .map(
            (row) => `<li class="item-highlight">
              <div class="item-highlight-head">
                <p><span class="item-id">${escapeHtml(row.id)}</span> ${escapeHtml(row.label || '')}</p>
                <span class="item-highlight-meta">mean ${Number(row.mean).toFixed(2)} / 7 · n = ${
              row.n
            } · P = ${Number(row.polarization).toFixed(2)}</span>
              </div>
              ${miniDistHtml(row.counts)}
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
  }

  function renderItemDistributionRow(item, labels) {
    const counts = Array.isArray(item.counts) ? item.counts : [0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(...counts, 1);
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<p><span class="item-id">${escapeHtml(item.id)}</span> ${escapeHtml(
      labels[item.id] || ''
    )}</p>
      <div class="dist-scale" aria-label="${escapeHtml(item.id)} distribution">
        ${counts
          .map(
            (count, index) =>
              `<div class="dist-col"><i data-count="${count}"></i><span>${index + 1} · ${count}</span></div>`
          )
          .join('')}
      </div>`;
    row.querySelectorAll('.dist-col i').forEach((bar) => {
      const count = Number(bar.getAttribute('data-count')) || 0;
      bar.style.height = `${Math.max(6, (count / max) * 64)}px`;
    });
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
    const ranked = rankItemHighlights(items, { labels, highlightCount: 5 });
    if (host) {
      host.innerHTML =
        renderHighlightGroup('Highest-scoring', ranked.highest) +
        renderHighlightGroup('Lowest-scoring', ranked.lowest) +
        renderHighlightGroup('Most divided', ranked.mostDivided);
    }
    if (allHost && (showAllItems || details?.open)) {
      items.forEach((item) => {
        allHost.append(renderItemDistributionRow(item, labels));
      });
    }
  }

  function renderLedger() {
    const body = document.getElementById('record-rows');
    const empty = document.getElementById('ledger-empty');
    const meta = document.getElementById('ledger-meta');
    body.innerHTML = '';
    empty.hidden = records.length > 0;
    const total = summary?.total ?? records.length;
    if (meta) {
      if (records.length || total) {
        meta.hidden = false;
        meta.textContent = `Showing ${records.length} of ${total}`;
      } else {
        meta.hidden = true;
        meta.textContent = '';
      }
    }
    records.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.participant_reference || '—')}</td>
        <td>${escapeHtml(formatWhen(row.accepted_at))}</td>
        <td>${escapeHtml(optionLabel(GEOGRAPHY, row.region))}</td>
        <td>${escapeHtml(optionLabel(ROLES, row.role))}</td>
        <td>${escapeHtml(optionLabel(EXPERIENCE, row.experience))}</td>
        <td>${escapeHtml(
          row.orientation != null ? `${Number(row.orientation).toFixed(2)} / 7` : '—'
        )}</td>`;
      body.append(tr);
    });
    if (exportBtn) exportBtn.disabled = true;
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
    renderIntake();
    renderTrend();
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
    params.set('limit', String(RESPONSE_PAGE_LIMIT));
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
