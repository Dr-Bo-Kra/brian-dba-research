const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  nav.classList.toggle('open', !open);
});
nav.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  })
);

(function initLinkedInCtas() {
  const url = String((window.BRIAN_DBA_CONFIG || {}).LINKEDIN_URL || '').trim();
  document.querySelectorAll('[data-linkedin]').forEach((link) => {
    if (url) {
      link.href = url;
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
      return;
    }
    link.href = '#';
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
    link.addEventListener('click', (e) => e.preventDefault());
  });
})();

const tabs = [...document.querySelectorAll('[role="tab"]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    selectTab(tabs[next]);
  });
});
function selectTab(selected) {
  tabs.forEach((tab) => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}

(function initInclusiveLendingDesk() {
  const flow = document.getElementById('survey-flow');
  if (!flow) return;

  const results = document.getElementById('survey-results');
  const summary = document.getElementById('survey-summary');
  const domainScoresEl = document.getElementById('domain-scores');
  const downloadBtn = document.getElementById('survey-download');
  const resetBtn = document.getElementById('survey-reset');
  const progressBar = document.getElementById('survey-progress-bar');
  const progressLabel = document.getElementById('survey-progress-label');
  const progressPct = document.getElementById('survey-progress-pct');
  const overallSummary = document.getElementById('results-overall-summary');
  const overallScoreEl = document.getElementById('results-overall-score');
  const overallLevelEl = document.getElementById('results-overall-level');
  const footnote = document.getElementById('survey-footnote');
  const radarChartEl = document.getElementById('radar-chart');
  const playStyleTitle = document.getElementById('play-style-title');
  const playStyleBlurb = document.getElementById('play-style-blurb');
  const playBadgeMark = document.getElementById('play-badge-mark');
  const archiveStatusEl = document.getElementById('archive-status');
  const participantGate = document.getElementById('participant-gate');
  const surveyShell = document.getElementById('survey-shell');
  const eligibilityConfirm = document.getElementById('eligibility-confirm');
  const consentConfirm = document.getElementById('consent-confirm');
  const consentContinue = document.getElementById('survey-consent-continue');

  const LATEST_KEY = 'brian-dba-survey-latest';
  const LEGACY_ARCHIVE_KEY = 'brian-dba-survey-responses';
  const INSTRUMENT = 'brian-dba-inclusive-lending-desk-v3';
  const INSTRUMENT_TYPE = 'mixed-methods-desk-assessment';
  const MIN_OPEN_LEN = 10;
  const LIKERT_MAX = 7;

  const cfg = window.BRIAN_DBA_CONFIG || {};
  const SUBMISSION_ENDPOINT = String(cfg.SUBMISSION_ENDPOINT || '').trim();
  const PRIVACY_NOTICE_VERSION = String(cfg.PRIVACY_NOTICE_VERSION || '2026-08-28').trim();

  function isProtectedSubmissionEndpoint(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.username || parsed.password) return false;
      const path = `${parsed.pathname}${parsed.search}`;
      if (/\/rest\/v1\//i.test(path)) return false;
      return true;
    } catch {
      return false;
    }
  }

  const archiveConfigured = Boolean(
    cfg.COLLECTION_ENABLED === true && isProtectedSubmissionEndpoint(SUBMISSION_ENDPOINT)
  );
  let participationConsent = null;
  const reduceMotion = (function () {
    try {
      return Boolean(
        typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch (e) {
      return false;
    }
  })();

  const LIKERT_SCALE = [
    { value: 1, label: 'Strongly Disagree' },
    { value: 2, label: 'Disagree' },
    { value: 3, label: 'Somewhat Disagree' },
    { value: 4, label: 'Neutral' },
    { value: 5, label: 'Somewhat Agree' },
    { value: 6, label: 'Agree' },
    { value: 7, label: 'Strongly Agree' },
  ];

  const GEOGRAPHY_OPTIONS = [
    { value: 'india', label: 'India' },
    { value: 'south-asia-other', label: 'South Asia (excluding India)' },
    { value: 'southeast-asia', label: 'Southeast Asia' },
    { value: 'east-asia', label: 'East Asia' },
    { value: 'middle-east', label: 'Middle East' },
    { value: 'africa', label: 'Africa' },
    { value: 'europe-uk', label: 'Europe or United Kingdom' },
    { value: 'north-america', label: 'North America' },
    { value: 'latin-america-caribbean', label: 'Latin America or Caribbean' },
    { value: 'oceania', label: 'Oceania' },
    { value: 'multi-region', label: 'Multi-region or global role' },
    { value: 'prefer-not', label: 'Prefer not to say' },
  ];

  const PROFILE_FIELDS = [
    {
      name: 'gender',
      label: 'Gender',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'male', label: 'Male' },
        { value: 'female', label: 'Female' },
        { value: 'prefer-not', label: 'Prefer not to say' },
      ],
    },
    {
      name: 'age',
      label: 'Age',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: '20-29', label: '20-29 years' },
        { value: '30-39', label: '30-39 years' },
        { value: '40-49', label: '40-49 years' },
        { value: '50-59', label: '50-59 years' },
        { value: '60plus', label: '60 years and above' },
      ],
    },
    {
      name: 'education',
      label: 'Highest educational qualification',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'diploma', label: 'Diploma' },
        { value: 'bachelors', label: "Bachelor's Degree" },
        { value: 'masters', label: "Master's Degree" },
        { value: 'doctorate', label: 'Doctorate' },
        { value: 'professional', label: 'Professional Qualification' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      name: 'institutionType',
      label: 'Type of financial institution',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'commercial-bank', label: 'Commercial Bank' },
        { value: 'mfi', label: 'Microfinance Institution' },
        { value: 'cooperative', label: 'Cooperative or Credit Union' },
        { value: 'fintech', label: 'FinTech Lending Company' },
        { value: 'digital-bank', label: 'Digital Bank' },
        { value: 'dfi', label: 'Development Financial Institution' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      name: 'position',
      label: 'Current position',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'credit-loan-officer', label: 'Credit or Loan Officer' },
        { value: 'credit-manager', label: 'Credit Manager' },
        { value: 'risk-manager', label: 'Risk Manager or Risk Analyst' },
        { value: 'underwriting', label: 'Underwriting Specialist' },
        { value: 'branch-manager', label: 'Branch Manager' },
        { value: 'product-development', label: 'Product Development Specialist' },
        { value: 'senior-management', label: 'Senior Management or Executive' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      name: 'yearsLending',
      label: 'Years of experience in lending or credit-related roles',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'lt2', label: 'Less than 2 years' },
        { value: '2-5', label: '2-5 years' },
        { value: '6-10', label: '6-10 years' },
        { value: '11-15', label: '11-15 years' },
        { value: 'gt15', label: 'More than 15 years' },
      ],
    },
    {
      name: 'yearsFinancialServices',
      label: 'Total years of professional experience in the financial services sector',
      required: true,
      bucket: 'qualitative',
      options: [
        { value: 'lt2', label: 'Less than 2 years' },
        { value: '2-5', label: '2-5 years' },
        { value: '6-10', label: '6-10 years' },
        { value: '11-15', label: '11-15 years' },
        { value: 'gt15', label: 'More than 15 years' },
      ],
    },
    {
      name: 'areaOperation',
      label: 'Primary area of operation',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'urban', label: 'Urban' },
        { value: 'rural', label: 'Rural' },
        { value: 'both', label: 'Both Urban and Rural' },
      ],
    },
    {
      name: 'involvement',
      label: 'Level of involvement in lending decisions',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'assess', label: 'I directly assess loan applications' },
        { value: 'recommend', label: 'I recommend loan applications for approval' },
        { value: 'approve-reject', label: 'I approve or reject loan applications' },
        { value: 'supervise', label: 'I supervise credit assessment activities' },
        { value: 'policies', label: 'I develop lending or credit policies' },
        {
          value: 'support',
          label: 'I support lending decisions through risk, technology, or product functions',
        },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      name: 'usesAltIndicators',
      label: 'Does your institution currently use alternative creditworthiness indicators?',
      required: true,
      bucket: 'quantitative',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'implementing', label: 'Currently Implementing' },
        { value: 'not-sure', label: 'Not Sure' },
      ],
    },
  ];

  const CASE_SCENARIO = [
    'You are evaluating a loan application from a micro-entrepreneur applying for business expansion financing.',
    'The applicant has: Limited formal credit history; Moderate but stable business income; Partial collateral; No previous loan defaults; Stable business operations.',
    'When answering the following sections, consider how additional borrower characteristics influence your professional lending decision.',
    'While answering, assume that traditional financial information (income, repayment history, and collateral) is adequate and comparable across applicants. Base your responses on your professional judgment regarding how the borrower\'s characteristics would influence a responsible lending decision.',
  ];

  const LIKERT_SECTIONS = [
    {
      id: 'psychometric',
      stageKey: 'likert-b',
      title: 'Mindset signals',
      chip: 'Psychometric cues',
      hint: 'Rate how strongly you agree that these mindset-related signals would shape a responsible lending decision for the case file.',
      domainLabel: 'Psychometric indicators',
      short: 'Psych',
      items: [
        {
          id: 'B1',
          text: 'A borrower who demonstrates strong financial discipline is more likely to receive the recommendation for loan approval.',
        },
        {
          id: 'B2',
          text: "A borrower's commitment to repaying financial obligations positively influences loan approval decisions.",
        },
        {
          id: 'B3',
          text: 'Evidence that a borrower plans and manages finances responsibly positively influences lending decisions.',
        },
        {
          id: 'B4',
          text: 'A borrower who demonstrates confidence in managing financial responsibilities is more likely to be considered creditworthy.',
        },
        {
          id: 'B5',
          text: 'Psychological characteristics such as responsibility, self-control, and commitment provide valuable information beyond traditional financial records when making lending decisions.',
        },
      ],
    },
    {
      id: 'social',
      stageKey: 'likert-c',
      title: 'Community signals',
      chip: 'Social capital',
      hint: 'Rate how community reputation, peers, and networks would inform the same case file.',
      domainLabel: 'Social capital',
      short: 'Social',
      items: [
        {
          id: 'C6',
          text: "A borrower's positive reputation within the community increases confidence in approving a loan application.",
        },
        {
          id: 'C7',
          text: 'Strong peer recommendations positively influence the assessment of borrower reliability.',
        },
        {
          id: 'C8',
          text: "Active participation in community or business groups increases the confidence in the borrower's creditworthiness.",
        },
        {
          id: 'C9',
          text: 'Evidence of strong community trust reduces uncertainty when making lending decisions.',
        },
        {
          id: 'C10',
          text: 'Social relationships and community support provide useful information beyond traditional financial indicators when evaluating loan applications.',
        },
      ],
    },
    {
      id: 'behavioral',
      stageKey: 'likert-d',
      title: 'Behavior signals',
      chip: 'Decision patterns',
      hint: 'Rate how behavioural patterns would influence your professional judgment on this file.',
      domainLabel: 'Behavioral economics',
      short: 'Behavior',
      items: [
        {
          id: 'D11',
          text: "Evidence that a borrower makes consistent financial decisions increases confidence in the borrower's ability to repay.",
        },
        {
          id: 'D12',
          text: 'Borrowers who avoid impulsive financial decisions are more likely to receive loan approval.',
        },
        {
          id: 'D13',
          text: 'A borrower who demonstrates responsible behaviour when managing financial risks is viewed more favourably during credit assessment.',
        },
        {
          id: 'D14',
          text: 'Behavioural information improves the assessment of creditworthiness beyond traditional financial records.',
        },
        {
          id: 'D15',
          text: 'Behavioural characteristics improve the quality of responsible lending decisions.',
        },
      ],
    },
    {
      id: 'readiness',
      stageKey: 'likert-e',
      title: 'Institutional readiness',
      chip: 'Org capacity',
      hint: 'Shift from the borrower file to your institution—how ready is the desk to use alternative signals responsibly?',
      domainLabel: 'Organizational readiness',
      short: 'Ready',
      items: [
        {
          id: 'E16',
          text: 'Organizational leadership supports the adoption of alternative creditworthiness assessment methods.',
        },
        {
          id: 'E17',
          text: 'The organization has clear policies governing the responsible use of alternative borrower information.',
        },
        {
          id: 'E18',
          text: 'The organization has adequate technological capability to implement alternative creditworthiness models.',
        },
        {
          id: 'E19',
          text: 'Employees receive sufficient training to evaluate alternative creditworthiness indicators responsibly.',
        },
        {
          id: 'E20',
          text: 'The organization is prepared to integrate alternative creditworthiness models into routine lending decisions while maintaining ethical and regulatory standards.',
        },
      ],
    },
    {
      id: 'inclusiveDecision',
      stageKey: 'likert-f',
      title: 'Inclusive decision stance',
      chip: 'Lending stance',
      hint: 'Last rating round—how should inclusion and responsibility show up in the decision?',
      domainLabel: 'Inclusive decision-making',
      short: 'Decision',
      items: [
        {
          id: 'F21',
          text: 'Creditworthy borrowers should be considered for loan approval even when they have limited traditional financial documentation.',
        },
        {
          id: 'F22',
          text: 'Lending decisions should balance responsible risk management with financial inclusion.',
        },
        {
          id: 'F23',
          text: 'Fairness and ethical responsibility should be considered when making lending decisions.',
        },
        {
          id: 'F24',
          text: 'Alternative creditworthiness information can improve responsible lending decisions without compromising credit quality.',
        },
        {
          id: 'F25',
          text: 'Incorporating alternative creditworthiness indicators leads to more responsible and inclusive lending decisions.',
        },
      ],
    },
  ];

  const QUAL_QUESTIONS = {
    adoption: [
      {
        id: 'Q1',
        text: 'What is your understanding of alternative creditworthiness indicators, such as psychometric characteristics, social capital, and behavioural financial information, in the context of lending decisions?',
      },
      {
        id: 'Q2',
        text: 'How do you think psychometric indicators (e.g., financial discipline, repayment commitment, and financial responsibility) can contribute to improving lending decisions?',
      },
      {
        id: 'Q3',
        text: 'In your opinion, what role do social capital indicators (e.g., community reputation, peer recommendations, and social networks) play in evaluating borrowers who have limited traditional credit histories?',
      },
      {
        id: 'Q4',
        text: 'How useful do you believe behavioural economic indicators (e.g., spending behaviour, financial decision-making patterns, and risk-taking behaviour) are in supporting responsible lending decisions?',
      },
      {
        id: 'Q5',
        text: 'What benefits and opportunities do you believe the adoption of alternative creditworthiness models can bring to your organization and to financially underserved borrowers?',
      },
    ],
    governance: [
      {
        id: 'Q6',
        text: 'What operational challenges do you anticipate your organization may face when implementing alternative creditworthiness assessment models?',
      },
      {
        id: 'Q7',
        text: 'What ethical concerns, if any, do you associate with using alternative borrower information in lending decisions?',
      },
      {
        id: 'Q8',
        text: 'What organizational capabilities, governance mechanisms, or regulatory support do you believe are necessary for the successful implementation of alternative creditworthiness models?',
      },
      {
        id: 'Q9',
        text: 'Based on your experience, what recommendations would you make to financial institutions and policymakers for promoting responsible and inclusive adoption of alternative creditworthiness models?',
      },
    ],
  };

  const DOMAINS_META = LIKERT_SECTIONS.map((s) => ({
    id: s.id,
    label: s.domainLabel,
    short: s.short,
    low: `Responses leaned cautious on ${s.domainLabel.toLowerCase()}—these signals carried limited weight in your desk orientation.`,
    mid: `A balanced view of ${s.domainLabel.toLowerCase()}—useful in places, with room to integrate more systematically.`,
    high: `Strong alignment with ${s.domainLabel.toLowerCase()} as informative beyond traditional records for responsible inclusive lending.`,
  }));

  const STAGES = [
    { key: 'profile', label: 'Your profile', pct: 8 },
    { key: 'case', label: 'The case', pct: 16 },
    ...LIKERT_SECTIONS.map((s, i) => ({
      key: s.stageKey,
      label: s.title,
      pct: 24 + i * 10,
      section: s,
    })),
    { key: 'qual-adoption', label: 'Your take · adoption', pct: 78 },
    { key: 'qual-governance', label: 'Your take · governance', pct: 90 },
    { key: 'results', label: 'Your results', pct: 100 },
  ];

  let stageIndex = 0;
  let startedAt = new Date().toISOString();
  let latestRecord = null;
  let state = {
    profile: {},
    quantitative: {
      demographics: {},
      vignetteAcknowledged: false,
      vignetteAcknowledgedAt: null,
      likert: {},
    },
    qualitative: {
      yearsFinancialServices: '',
      roleDescription: '',
      altIndicatorsExplain: '',
      openResponses: {},
    },
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function mean(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function levelFor(score) {
    if (score >= 5.5) return { id: 'inclusion-forward', label: 'Inclusion-forward' };
    if (score >= 4) return { id: 'balanced', label: 'Balanced' };
    return { id: 'cautious', label: 'Cautious' };
  }

  function interpretDomain(meta, score) {
    if (score >= 5.5) return meta.high;
    if (score >= 4) return meta.mid;
    return meta.low;
  }

  function optionLabel(fieldName, value) {
    const field = PROFILE_FIELDS.find((f) => f.name === fieldName);
    const hit = field?.options?.find((o) => o.value === value);
    return hit?.label || value || '—';
  }

  function updateProgress() {
    const stage = STAGES[stageIndex] || STAGES[0];
    const steps = Math.max(STAGES.length - 1, 1);
    const pct = stageIndex <= 0 ? 0 : Math.round((stageIndex / steps) * 100);
    if (progressLabel) progressLabel.textContent = stage.label;
    if (progressPct) progressPct.textContent = `${pct}% complete`;
    if (progressBar) progressBar.style.width = `${pct}%`;
  }

  function focusStageTitle() {
    const title = flow.querySelector('.phase-title, #desk-stage-title');
    if (!title) return;
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    try {
      if (typeof title.focus === 'function') title.focus({ preventScroll: true });
    } catch (e) {
      /* embedded browsers may lack focus options */
    }
  }

  function scrollElementIntoView(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try {
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    } catch (e) {
      try {
        el.scrollIntoView(true);
      } catch (e2) {
        /* ignore */
      }
    }
  }

  function showStageError(message) {
    let err = flow.querySelector('#stage-error');
    if (!err) {
      err = document.createElement('p');
      err.id = 'stage-error';
      err.className = 'field-error stage-error';
      err.setAttribute('role', 'alert');
      const actions = flow.querySelector('.survey-actions');
      if (actions) actions.before(err);
      else flow.append(err);
    }
    err.hidden = false;
    err.textContent = message;
  }

  function clearStageError() {
    const err = flow.querySelector('#stage-error');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
    flow.querySelectorAll('.field.invalid').forEach((el) => el.classList.remove('invalid'));
    flow.querySelectorAll('.field-error[data-field-error]').forEach((el) => {
      el.hidden = true;
    });
  }

  function wireNav(showBack, onBack, onNext) {
    document.getElementById('stage-next')?.addEventListener('click', onNext);
    if (showBack) {
      document.getElementById('stage-back')?.addEventListener('click', onBack);
    }
  }

  function stageShell(bodyHtml, { showBack, nextLabel }) {
    const playable = STAGES.filter((s) => s.key !== 'results');
    const current = playable[Math.min(stageIndex, playable.length - 1)];
    const stepNum = Math.min(stageIndex + 1, playable.length);

    return `
      <div class="desk-stage inclusive-desk" id="desk-stage-root" tabindex="-1">
        <div class="desk-toolbar">
          <p class="desk-toolbar-label">Beyond the credit file · challenge</p>
          <span class="desk-stage-index">Stage ${stepNum} of ${playable.length}</span>
        </div>
        <div class="stage-progress-simple" aria-hidden="true">
          ${playable
            .map((_, i) => {
              const cls = i < stageIndex ? 'done' : i === stageIndex ? 'current' : '';
              return `<i class="${cls}"></i>`;
            })
            .join('')}
        </div>
        <p class="stage-now-label">${escapeHtml(current ? current.label : '')}</p>
        <div class="survey-step desk-stage-body">
          ${bodyHtml}
          <p class="field-error" id="stage-error" hidden role="alert"></p>
          <div class="survey-actions">
            ${showBack ? '<button type="button" class="button ghost" id="stage-back">← Back</button>' : ''}
            <button type="button" class="button primary" id="stage-next">${escapeHtml(nextLabel)} <span aria-hidden="true">→</span></button>
          </div>
        </div>
      </div>
    `;
  }

  function renderProfileStage() {
    const selects = PROFILE_FIELDS.map((field) => {
      const current =
        field.bucket === 'qualitative'
          ? state.qualitative[field.name] || ''
          : state.quantitative.demographics[field.name] || state.profile[field.name] || '';
      const opts = field.options
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}" ${current === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
        )
        .join('');
      return `
        <div class="field" data-field="${escapeHtml(field.name)}">
          <label for="field-${escapeHtml(field.name)}">${escapeHtml(field.label)} <span aria-hidden="true">*</span></label>
          <select id="field-${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" required>
            <option value="">Select one…</option>
            ${opts}
          </select>
          <p class="field-error" data-field-error hidden>Please complete this field.</p>
        </div>
      `;
    }).join('');

    const country = state.quantitative.demographics.countryRegion || '';
    const geographyOptions = GEOGRAPHY_OPTIONS.map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${country === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`
    ).join('');
    const roleDesc = state.qualitative.roleDescription || '';
    const altExplain = state.qualitative.altIndicatorsExplain || '';

    const bodyHtml = `
      <h3 class="phase-title" id="desk-stage-title">Your profile</h3>
      <p class="survey-hint">A few details for the research record—then you open the case. This is a research challenge, not a clinical diagnosis or credit decision tool.</p>
      <form id="profile-form" class="survey-form" novalidate>
        ${selects}
        <div class="field" data-field="countryRegion">
          <label for="field-countryRegion">Broad region of operation <span aria-hidden="true">*</span></label>
          <select id="field-countryRegion" name="countryRegion" required>
            <option value="">Select one…</option>
            ${geographyOptions}
          </select>
          <p class="field-error" data-field-error hidden>Please select a broad region.</p>
        </div>
        <div class="field" data-field="roleDescription">
          <label for="field-roleDescription">Briefly describe your current roles and responsibilities related to lending or credit assessment <span aria-hidden="true">*</span></label>
          <textarea id="field-roleDescription" name="roleDescription" rows="3" maxlength="1200" required minlength="${MIN_OPEN_LEN}" placeholder="Your day-to-day credit or lending responsibilities…">${escapeHtml(roleDesc)}</textarea>
          <p class="field-error" data-field-error hidden>Please write at least ${MIN_OPEN_LEN} characters.</p>
        </div>
        <div class="field" data-field="altIndicatorsExplain">
          <label for="field-altIndicatorsExplain">If relevant, briefly explain how your organization uses (or does not use) alternative creditworthiness indicators <span class="optional-tag">(optional)</span></label>
          <textarea id="field-altIndicatorsExplain" name="altIndicatorsExplain" rows="3" maxlength="1200" placeholder="Optional detail…">${escapeHtml(altExplain)}</textarea>
        </div>
      </form>
    `;

    flow.innerHTML = stageShell(bodyHtml, {
      showBack: false,
      nextLabel: 'Open the case',
    });

    wireNav(false, null, () => {
      if (!validateAndCollectProfile()) return;
      goToStage(1);
    });
  }

  function validateAndCollectProfile() {
    clearStageError();
    let valid = true;
    const form = document.getElementById('profile-form');
    if (!form) return false;

    PROFILE_FIELDS.forEach((field) => {
      const el = form.querySelector(`[name="${field.name}"]`);
      const wrap = form.querySelector(`[data-field="${field.name}"]`);
      const err = wrap?.querySelector('[data-field-error]');
      if (!el || !String(el.value || '').trim()) {
        valid = false;
        wrap?.classList.add('invalid');
        if (err) err.hidden = false;
      }
    });

    const countryEl = form.querySelector('[name="countryRegion"]');
    const countryWrap = form.querySelector('[data-field="countryRegion"]');
    if (!String(countryEl?.value || '').trim()) {
      valid = false;
      countryWrap?.classList.add('invalid');
      const err = countryWrap?.querySelector('[data-field-error]');
      if (err) err.hidden = false;
    }

    const roleEl = form.querySelector('[name="roleDescription"]');
    const roleWrap = form.querySelector('[data-field="roleDescription"]');
    const roleVal = String(roleEl?.value || '').trim();
    if (roleVal.length < MIN_OPEN_LEN) {
      valid = false;
      roleWrap?.classList.add('invalid');
      const err = roleWrap?.querySelector('[data-field-error]');
      if (err) err.hidden = false;
    }

    if (!valid) {
      showStageError('Please complete the required clearance fields before continuing.');
      form.querySelector('.field.invalid select, .field.invalid input, .field.invalid textarea')?.focus();
      return false;
    }

    const demographics = {};
    PROFILE_FIELDS.forEach((field) => {
      const val = String(form.querySelector(`[name="${field.name}"]`)?.value || '').trim();
      if (field.bucket === 'qualitative') {
        state.qualitative[field.name] = val;
      } else {
        demographics[field.name] = val;
      }
    });
    demographics.countryRegion = String(countryEl?.value || '').trim();
    state.quantitative.demographics = demographics;
    state.qualitative.roleDescription = roleVal;
    state.qualitative.altIndicatorsExplain = String(
      form.querySelector('[name="altIndicatorsExplain"]')?.value || ''
    ).trim();

    state.profile = {
      ...demographics,
      yearsFinancialServices: state.qualitative.yearsFinancialServices,
      roleDescription: state.qualitative.roleDescription,
      altIndicatorsExplain: state.qualitative.altIndicatorsExplain || undefined,
    };
    return true;
  }

  function renderCaseStage() {
    const paragraphs = CASE_SCENARIO.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    const bodyHtml = `
      <h3 class="phase-title" id="desk-stage-title">The case</h3>
      <p class="survey-hint">One standardized thin-file application. Your ratings later apply to this borrower.</p>
      <article class="case-card dossier case-dossier" aria-labelledby="desk-stage-title">
        <div class="dossier-header">
          <div class="borrower-portrait" aria-hidden="true">
            <svg viewBox="0 0 100 100" focusable="false">
              <rect width="100" height="100" fill="#1a5c52"/>
              <circle cx="50" cy="50" r="46" fill="none" stroke="#b8e65a" stroke-width="1.5" opacity=".45"/>
              <ellipse cx="50" cy="38" rx="16" ry="18" fill="#c48a5a"/>
              <path d="M28 28c4-14 40-14 44 2 2 10-4 18-10 20-8 2-18 2-26-2-6-4-10-12-8-20z" fill="#2a1a12"/>
              <path d="M34 78c2-16 14-24 16-24s14 8 16 24" fill="#27b5a5"/>
            </svg>
          </div>
          <div class="dossier-identity">
            <div class="case-meta">
              <span class="case-tag">Micro-entrepreneur</span>
              <span class="case-amount">Business expansion</span>
            </div>
            <h4 class="case-role">Standardized thin-file applicant</h4>
            <p class="stake-tag">Traditional financial evidence held constant across respondents.</p>
          </div>
        </div>
        <div class="dossier-body case-scenario">
          ${paragraphs}
        </div>
      </article>
    `;

    flow.innerHTML = stageShell(bodyHtml, {
      showBack: true,
      nextLabel: 'Rate the signals',
    });

    wireNav(
      true,
      () => goToStage(0),
      () => {
        state.quantitative.vignetteAcknowledged = true;
        state.quantitative.vignetteAcknowledgedAt = new Date().toISOString();
        goToStage(2);
      }
    );
  }

  function likertLegendHtml() {
    return `
      <div class="likert-legend likert-legend-7" role="note" aria-label="Response scale from 1 Strongly Disagree to 7 Strongly Agree">
        ${LIKERT_SCALE.map((s) => `<span><strong>${s.value}</strong> ${escapeHtml(s.label)}</span>`).join('')}
      </div>
    `;
  }

  function renderLikertStage(section) {
    const itemsHtml = section.items
      .map((item) => {
        const current = state.quantitative.likert[item.id];
        const radios = LIKERT_SCALE.map(
          (s) => `
          <label>
            <input type="radio" name="${escapeHtml(item.id)}" value="${s.value}" ${
            Number(current) === s.value ? 'checked' : ''
          } required>
            <span>${s.value}</span>
            <span class="sr-only">${escapeHtml(s.label)}</span>
          </label>`
        ).join('');
        return `
          <div class="likert-item field" data-field="${escapeHtml(item.id)}">
            <fieldset>
              <legend><span class="item-id">${escapeHtml(item.id)}</span> ${escapeHtml(item.text)}</legend>
              <div class="likert-scale numbered likert-scale-7" role="radiogroup" aria-label="${escapeHtml(item.id)}: ${escapeHtml(item.text)}">
                ${radios}
              </div>
            </fieldset>
            <p class="field-error" data-field-error hidden>Please select a rating from 1 to 7.</p>
          </div>
        `;
      })
      .join('');

    const bodyHtml = `
      <p class="stage-kicker"><span class="stage-chip current">${escapeHtml(section.chip)}</span></p>
      <h3 class="phase-title" id="desk-stage-title">${escapeHtml(section.title)}</h3>
      <p class="survey-hint">${escapeHtml(section.hint)}</p>
      ${likertLegendHtml()}
      <form id="likert-form" class="survey-form likert-form" novalidate>
        ${itemsHtml}
      </form>
    `;

    const sectionIndex = LIKERT_SECTIONS.findIndex((s) => s.id === section.id);
    const absIndex = 2 + sectionIndex;

    flow.innerHTML = stageShell(bodyHtml, {
      showBack: true,
      nextLabel: sectionIndex === LIKERT_SECTIONS.length - 1 ? 'Share your take' : 'Next round',
    });

    wireNav(
      true,
      () => goToStage(absIndex - 1),
      () => {
        if (!validateAndCollectLikert(section)) return;
        goToStage(absIndex + 1);
      }
    );
  }

  function validateAndCollectLikert(section) {
    clearStageError();
    let valid = true;
    section.items.forEach((item) => {
      const checked = flow.querySelector(`input[name="${item.id}"]:checked`);
      const wrap = flow.querySelector(`[data-field="${item.id}"]`);
      const err = wrap?.querySelector('[data-field-error]');
      if (!checked) {
        valid = false;
        wrap?.classList.add('invalid');
        if (err) err.hidden = false;
      } else {
        state.quantitative.likert[item.id] = Number(checked.value);
      }
    });
    if (!valid) {
      showStageError('Please rate every statement before continuing.');
      flow.querySelector('.field.invalid input')?.focus();
      return false;
    }
    return true;
  }

  function renderQualStage(kind) {
    const questions = QUAL_QUESTIONS[kind];
    const isAdoption = kind === 'adoption';
    const title = isAdoption ? 'Your take · adoption' : 'Your take · governance';
    const hint = isAdoption
      ? 'In your own words: how alternative indicators could improve lending decisions and what opportunities you see.'
      : 'In your own words: operational friction, ethics, governance needs, and what you would recommend.';

    const fields = questions
      .map((q) => {
        const val = state.qualitative.openResponses[q.id] || '';
        return `
          <div class="field" data-field="${escapeHtml(q.id)}">
            <label for="field-${escapeHtml(q.id)}"><span class="item-id">${escapeHtml(q.id)}</span> ${escapeHtml(q.text)} <span aria-hidden="true">*</span></label>
            <textarea id="field-${escapeHtml(q.id)}" name="${escapeHtml(q.id)}" rows="4" maxlength="2000" required minlength="${MIN_OPEN_LEN}">${escapeHtml(val)}</textarea>
            <p class="field-error" data-field-error hidden>Please write at least ${MIN_OPEN_LEN} characters.</p>
          </div>
        `;
      })
      .join('');

    const bodyHtml = `
      <h3 class="phase-title" id="desk-stage-title">${escapeHtml(title)}</h3>
      <p class="survey-hint">${escapeHtml(hint)}</p>
      <form id="qual-form" class="survey-form" novalidate>
        ${fields}
      </form>
    `;

    const absIndex = isAdoption ? 7 : 8;
    flow.innerHTML = stageShell(bodyHtml, {
      showBack: true,
      nextLabel: isAdoption ? 'Continue' : 'Unlock my profile',
    });

    wireNav(
      true,
      () => goToStage(absIndex - 1),
      () => {
        if (!validateAndCollectQual(questions)) return;
        if (isAdoption) goToStage(8);
        else finishAssessment();
      }
    );
  }

  function validateAndCollectQual(questions) {
    clearStageError();
    let valid = true;
    questions.forEach((q) => {
      const el = flow.querySelector(`[name="${q.id}"]`);
      const wrap = flow.querySelector(`[data-field="${q.id}"]`);
      const err = wrap?.querySelector('[data-field-error]');
      const val = String(el?.value || '').trim();
      if (val.length < MIN_OPEN_LEN) {
        valid = false;
        wrap?.classList.add('invalid');
        if (err) err.hidden = false;
      } else {
        state.qualitative.openResponses[q.id] = val;
      }
    });
    if (!valid) {
      showStageError(`Please complete each reflection with at least ${MIN_OPEN_LEN} characters.`);
      flow.querySelector('.field.invalid textarea')?.focus();
      return false;
    }
    return true;
  }

  function scoreAssessment() {
    const likert = state.quantitative.likert;
    const domainResults = LIKERT_SECTIONS.map((section) => {
      const meta = DOMAINS_META.find((d) => d.id === section.id);
      const values = section.items.map((item) => Number(likert[item.id]));
      const score = Number(mean(values).toFixed(2));
      const level = levelFor(score);
      return {
        id: section.id,
        label: meta.label,
        score,
        max: LIKERT_MAX,
        percent: Math.round((score / LIKERT_MAX) * 100),
        level: level.id,
        levelLabel: level.label,
        interpretation: interpretDomain(meta, score),
        itemIds: section.items.map((i) => i.id),
      };
    });

    const overallScore = Number(mean(domainResults.map((d) => d.score)).toFixed(2));
    const overallLevel = levelFor(overallScore);
    const strongest = [...domainResults].sort((a, b) => b.score - a.score)[0];
    const weakest = [...domainResults].sort((a, b) => a.score - b.score)[0];

    let summaryText =
      'Your desk orientation toward alternative creditworthiness signals for responsible inclusive lending is mixed—useful signal review with room to sharpen stance.';
    if (overallScore >= 5.5) {
      summaryText =
        'Your responses lean inclusion-forward: alternative signals and responsible access sit comfortably alongside risk and ethics considerations.';
    } else if (overallScore >= 4) {
      summaryText =
        'Your responses suggest a balanced desk stance—open to alternative evidence while keeping traditional caution in view.';
    } else {
      summaryText =
        'Your responses lean cautious: traditional evidence still dominates, with alternative signals carrying less weight in the orientation.';
    }
    summaryText += ` Strongest domain: ${strongest.label}. Area to watch: ${weakest.label}. This is an interpretive orientation from your answers—not a clinical diagnosis or credit score.`;

    const playStyle = derivePlayStyle(domainResults, overallScore);

    return {
      domains: domainResults,
      overall: {
        score: overallScore,
        max: LIKERT_MAX,
        percent: Math.round((overallScore / LIKERT_MAX) * 100),
        level: overallLevel.id,
        levelLabel: overallLevel.label,
        summary: summaryText,
        strongestDomain: strongest.id,
        weakestDomain: weakest.id,
      },
      playStyle,
    };
  }

  function derivePlayStyle(domains, overall) {
    const byId = Object.fromEntries(domains.map((d) => [d.id, d.score]));
    const sorted = [...domains].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const second = sorted[1];

    if (byId.readiness >= 5.5 && byId.inclusiveDecision >= 5.2) {
      return {
        id: 'adoption-ready',
        mark: 'AR',
        title: 'The Adoption Pioneer',
        blurb:
          'You unlocked a readiness-forward profile: institutions and inclusion both score high. You’re closest to someone who’d actually integrate alternative signals—without dropping the governance bar.',
      };
    }
    if (top.id === 'social' || (byId.social >= 5.5 && second.id === 'psychometric')) {
      return {
        id: 'community-anchored',
        mark: 'CA',
        title: 'The Community Reader',
        blurb:
          'Reputation, peers and networks carry the most weight in your profile. For thin-file borrowers, you look past the paperwork into who stands with them.',
      };
    }
    if (top.id === 'psychometric') {
      return {
        id: 'mindset-reader',
        mark: 'MR',
        title: 'The Mindset Reader',
        blurb:
          'Discipline, commitment and self-control light up your radar. You treat character cues as real evidence—not soft decoration around the credit file.',
      };
    }
    if (top.id === 'behavioral') {
      return {
        id: 'behavior-spotter',
        mark: 'BS',
        title: 'The Behavior Spotter',
        blurb:
          'Consistency, impulse control and risk patterns lead your profile. You watch how people decide under pressure—not just what their documents claim.',
      };
    }
    if (top.id === 'inclusiveDecision' && overall >= 4) {
      return {
        id: 'inclusion-balancer',
        mark: 'IB',
        title: 'The Inclusion Balancer',
        blurb:
          'Fair access and responsible risk share the stage. You want alternative signals to open doors—without lowering the quality of the book.',
      };
    }
    if (overall < 4) {
      return {
        id: 'traditional-anchor',
        mark: 'TA',
        title: 'The File-First Guard',
        blurb:
          'Your profile stays closer to conventional caution. That’s a usable finding too: the research asks how institutions earn trust in new evidence without losing control.',
      };
    }
    return {
      id: 'balanced-desk',
      mark: 'BD',
      title: 'The Balanced Signaler',
      blurb:
        'No single domain dominates. You blend mindset, community, behavior, readiness and inclusion—your growth edge is turning that mix into a clear institutional playbook.',
    };
  }

  function buildRecord() {
    const assessment = scoreAssessment();
    const quantitative = {
      demographics: { ...state.quantitative.demographics },
      vignetteAcknowledged: Boolean(state.quantitative.vignetteAcknowledged),
      vignetteAcknowledgedAt: state.quantitative.vignetteAcknowledgedAt,
      likert: { ...state.quantitative.likert },
    };
    const qualitative = {
      yearsFinancialServices: state.qualitative.yearsFinancialServices,
      roleDescription: state.qualitative.roleDescription,
      altIndicatorsExplain: state.qualitative.altIndicatorsExplain || undefined,
      openResponses: { ...state.qualitative.openResponses },
    };

    return {
      id: `resp_${createRandomId()}`,
      instrument: INSTRUMENT,
      instrumentType: INSTRUMENT_TYPE,
      disclaimer:
        'Research-oriented mixed-methods desk instrument / proposal demo. Not a clinical diagnosis, credit score, or institutional decision.',
      savedAt: new Date().toISOString(),
      sessionStartedAt: startedAt,
      consent: { ...participationConsent },
      profile: { ...state.profile },
      responses: {
        quantitative,
        qualitative,
      },
      quantitative,
      qualitative,
      assessment,
    };
  }

  function createRandomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function purgeStorageByPrefix(storage, prefixes) {
    if (!storage) return;
    const doomed = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    doomed.forEach((key) => storage.removeItem(key));
  }

  function purgeLegacyLocalData() {
    const prefixes = ['brian-dba-'];
    try {
      localStorage.removeItem(LATEST_KEY);
      localStorage.removeItem(LEGACY_ARCHIVE_KEY);
      purgeStorageByPrefix(localStorage, prefixes);
    } catch {
      /* storage can be unavailable */
    }
  }

  function purgeAllLocalSurveyData() {
    try {
      sessionStorage.removeItem(LATEST_KEY);
      sessionStorage.removeItem(LEGACY_ARCHIVE_KEY);
      purgeStorageByPrefix(sessionStorage, ['brian-dba-']);
    } catch {
      /* storage can be unavailable */
    }
    purgeLegacyLocalData();
  }

  function saveRecord(record) {
    latestRecord = record;
    try {
      sessionStorage.setItem(LATEST_KEY, JSON.stringify(record));
    } catch {
      /* private mode / quota */
    }
    purgeLegacyLocalData();
  }

  function setArchiveStatus(status, message) {
    if (!archiveStatusEl) return;
    archiveStatusEl.hidden = false;
    archiveStatusEl.dataset.state = status;
    archiveStatusEl.textContent = message;
  }

  function buildArchivePayload(record) {
    return {
      instrument_id: record.instrument || INSTRUMENT,
      client_record_id: record.id || null,
      profile: record.profile || {},
      responses: {
        quantitative: record.responses?.quantitative || record.quantitative || {},
        qualitative: record.responses?.qualitative || record.qualitative || {},
        instrumentType: record.instrumentType,
        sessionStartedAt: record.sessionStartedAt,
        savedAt: record.savedAt,
        disclaimer: record.disclaimer,
      },
      assessment: record.assessment || {},
      privacy_notice_version: record.consent?.privacyNoticeVersion,
      consented_at: record.consent?.consentedAt,
    };
  }

  async function submitToResearchArchive(record) {
    if (!archiveConfigured) {
      setArchiveStatus('local', 'Saved locally only (offline / not configured)');
      return { ok: false, reason: 'not-configured' };
    }

    setArchiveStatus('pending', 'Saving to research archive…');

    try {
      const res = await fetch(SUBMISSION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify(buildArchivePayload(record)),
      });

      if (!res.ok) {
        setArchiveStatus('local', 'Saved locally only (offline / not configured)');
        return { ok: false, reason: 'http', status: res.status };
      }

      setArchiveStatus('archived', 'Saved to research archive');
      purgeAllLocalSurveyData();
      return { ok: true };
    } catch {
      setArchiveStatus('local', 'Saved locally only (offline / not configured)');
      return { ok: false, reason: 'network' };
    }
  }

  function renderRadar(domains) {
    if (!radarChartEl) return;
    const size = 320;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 110;
    const n = domains.length;
    const angleAt = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pointAt = (i, score) => {
      const a = angleAt(i);
      const r = (score / LIKERT_MAX) * radius;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };

    let grid = '';
    [1, 2, 3, 4, 5, 6, 7].forEach((level) => {
      const pts = domains
        .map((_, i) => {
          const [x, y] = pointAt(i, level);
          return `${x},${y}`;
        })
        .join(' ');
      grid += `<polygon class="radar-grid" points="${pts}" />`;
    });

    let axes = '';
    let labelsSvg = '';
    domains.forEach((d, i) => {
      const [x, y] = pointAt(i, LIKERT_MAX);
      axes += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" />`;
      const [lx, ly] = pointAt(i, LIKERT_MAX * 1.12);
      const meta = DOMAINS_META.find((m) => m.id === d.id);
      labelsSvg += `<text class="radar-label" x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(
        meta?.short || d.label
      )}</text>`;
    });

    const areaPts = domains
      .map((d, i) => {
        const [x, y] = pointAt(i, d.score);
        return `${x},${y}`;
      })
      .join(' ');

    let dots = '';
    domains.forEach((d, i) => {
      const [x, y] = pointAt(i, d.score);
      dots += `<circle class="radar-point" cx="${x}" cy="${y}" r="4"><title>${escapeHtml(d.label)}: ${d.score.toFixed(
        2
      )} / ${LIKERT_MAX}</title></circle>`;
    });

    radarChartEl.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Radar of five domain scores from 1 to 7">
      ${grid}${axes}
      <polygon class="radar-area" points="${areaPts}" />
      ${dots}${labelsSvg}
    </svg>`;
  }

  function renderRecordSummary(record) {
    if (!summary) return;
    summary.innerHTML = '';
    const dem = record.responses?.quantitative?.demographics || {};
    const qual = record.responses?.qualitative || {};
    const rows = [
      { title: 'Gender', value: optionLabel('gender', dem.gender) },
      { title: 'Age', value: optionLabel('age', dem.age) },
      { title: 'Education', value: optionLabel('education', dem.education) },
      { title: 'Institution', value: optionLabel('institutionType', dem.institutionType) },
      { title: 'Position', value: optionLabel('position', dem.position) },
      { title: 'Years in lending', value: optionLabel('yearsLending', dem.yearsLending) },
      {
        title: 'Years in financial services',
        value: optionLabel('yearsFinancialServices', qual.yearsFinancialServices),
      },
      { title: 'Area of operation', value: optionLabel('areaOperation', dem.areaOperation) },
      { title: 'Involvement', value: optionLabel('involvement', dem.involvement) },
      {
        title: 'Uses alternative indicators',
        value: optionLabel('usesAltIndicators', dem.usesAltIndicators),
      },
      {
        title: 'Broad region of operation',
        value: GEOGRAPHY_OPTIONS.find((option) => option.value === dem.countryRegion)?.label || '—',
      },
    ];

    if (record.assessment?.playStyle) {
      rows.push({ title: 'Desk style', value: record.assessment.playStyle.title });
    }

    if (qual.roleDescription) {
      rows.push({ title: 'Role description', value: qual.roleDescription });
    }
    if (qual.altIndicatorsExplain) {
      rows.push({ title: 'Alt. indicators note', value: qual.altIndicatorsExplain });
    }

    Object.entries(qual.openResponses || {}).forEach(([id, text]) => {
      rows.push({ title: id, value: text });
    });

    rows.forEach(({ title, value }) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = title;
      dd.textContent = value;
      row.append(dt, dd);
      summary.append(row);
    });
  }

  function renderAssessment(record) {
    const { assessment } = record;
    if (overallSummary) overallSummary.textContent = assessment.overall.summary;
    if (overallScoreEl) {
      overallScoreEl.textContent = `${assessment.overall.score.toFixed(2)} / ${assessment.overall.max}`;
    }
    if (overallLevelEl) overallLevelEl.textContent = assessment.overall.levelLabel;

    if (assessment.playStyle) {
      if (playStyleTitle) playStyleTitle.textContent = assessment.playStyle.title;
      if (playStyleBlurb) playStyleBlurb.textContent = assessment.playStyle.blurb;
      if (playBadgeMark) playBadgeMark.textContent = assessment.playStyle.mark || 'LD';
    }

    renderRadar(assessment.domains);
    if (domainScoresEl) {
      domainScoresEl.innerHTML = '';
      assessment.domains.forEach((domain) => {
        const article = document.createElement('article');
        article.className = 'domain-score';
        article.setAttribute('role', 'listitem');
        article.innerHTML = `
          <div class="domain-score-head">
            <strong>${escapeHtml(domain.label)}</strong>
            <span>${domain.score.toFixed(2)} / ${domain.max}</span>
          </div>
          <div class="domain-bar" aria-hidden="true"><i></i></div>
          <span class="domain-level">${escapeHtml(domain.levelLabel)}</span>
          <p>${escapeHtml(domain.interpretation)}</p>
        `;
        domainScoresEl.append(article);
        requestAnimationFrame(() => {
          const bar = article.querySelector('.domain-bar > i');
          if (bar) bar.style.width = `${domain.percent}%`;
        });
      });
    }

    renderRecordSummary(record);
  }

  function showResults(record, { submitArchive = false } = {}) {
    stageIndex = STAGES.length - 1;
    updateProgress();
    flow.hidden = true;
    if (footnote) footnote.hidden = true;
    if (results) results.hidden = false;
    renderAssessment(record);

    const stamp = results?.querySelector('.decision-stamp') || document.getElementById('decision-stamp');
    if (stamp) {
      stamp.hidden = false;
      stamp.classList.add('show', 'approve');
      const text = stamp.querySelector('#decision-stamp-text') || stamp;
      if (text !== stamp) text.textContent = 'COMPLETE';
    } else if (results && !reduceMotion) {
      results.classList.add('desk-complete');
    }

    if (submitArchive) {
      void submitToResearchArchive(record);
    } else if (archiveStatusEl) {
      archiveStatusEl.hidden = true;
      archiveStatusEl.textContent = '';
      delete archiveStatusEl.dataset.state;
    }

    try {
      if (results && typeof results.focus === 'function') results.focus({ preventScroll: true });
    } catch (e) {
      /* ignore */
    }
    scrollElementIntoView(results);
  }

  function finishAssessment() {
    const record = buildRecord();
    saveRecord(record);
    showResults(record, { submitArchive: true });
  }

  function goToStage(index, options) {
    const opts = options || {};
    stageIndex = Math.max(0, Math.min(index, STAGES.length - 1));
    updateProgress();

    if (results) results.hidden = true;
    flow.hidden = false;
    if (footnote) footnote.hidden = false;

    const stage = STAGES[stageIndex];
    if (stage.key === 'profile') renderProfileStage();
    else if (stage.key === 'case') renderCaseStage();
    else if (stage.section) renderLikertStage(stage.section);
    else if (stage.key === 'qual-adoption') renderQualStage('adoption');
    else if (stage.key === 'qual-governance') renderQualStage('governance');
    else if (stage.key === 'results' && latestRecord) {
      showResults(latestRecord, { submitArchive: false });
      return;
    }

    if (opts.focus !== false) focusStageTitle();
    if (opts.scroll !== false) scrollElementIntoView(flow);
  }

  function resetState() {
    startedAt = new Date().toISOString();
    latestRecord = null;
    state = {
      profile: {},
      quantitative: {
        demographics: {},
        vignetteAcknowledged: false,
        vignetteAcknowledgedAt: null,
        likert: {},
      },
      qualitative: {
        yearsFinancialServices: '',
        roleDescription: '',
        altIndicatorsExplain: '',
        openResponses: {},
      },
    };
  }

  function readSavedLatest() {
    try {
      const saved = sessionStorage.getItem(LATEST_KEY);
      if (!saved) return null;
      const record = JSON.parse(saved);
      if (
        record?.instrument === INSTRUMENT &&
        record?.instrumentType === INSTRUMENT_TYPE &&
        record?.assessment?.domains
      ) {
        return record;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function offerResumeIfSaved() {
    const record = readSavedLatest();
    if (!record) return;
    latestRecord = record;
    if (document.getElementById('survey-resume-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'survey-resume-banner';
    banner.className = 'survey-resume-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <p>A previous result is saved in this browser tab.</p>
      <div class="survey-resume-actions">
        <button type="button" class="button ghost" id="survey-view-saved">View last result</button>
        <button type="button" class="button ghost" id="survey-dismiss-saved">Play a new round</button>
      </div>
    `;
    flow.before(banner);

    document.getElementById('survey-view-saved')?.addEventListener('click', () => {
      banner.remove();
      showResults(record, { submitArchive: false });
    });
    document.getElementById('survey-dismiss-saved')?.addEventListener('click', () => {
      banner.remove();
    });
  }

  function downloadRecord() {
    if (!latestRecord) return;
    const blob = new Blob([JSON.stringify(latestRecord, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${latestRecord.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadBtn && downloadBtn.addEventListener('click', downloadRecord);

  resetBtn &&
    resetBtn.addEventListener('click', () => {
      purgeAllLocalSurveyData();
      if (archiveStatusEl) {
        archiveStatusEl.hidden = true;
        archiveStatusEl.textContent = '';
        delete archiveStatusEl.dataset.state;
      }
      resetState();
      returnToConsentGate();
    });

  if (footnote) {
    footnote.textContent =
      'A completed result is kept only in this browser tab. If protected collection is enabled, this page will clearly show whether submission to the research archive succeeded.';
  }

  function hasValidConsent() {
    return Boolean(
      participationConsent?.privacyNoticeVersion &&
        participationConsent?.consentedAt &&
        participationConsent?.adultEligibilityConfirmed &&
        participationConsent?.voluntaryParticipationConfirmed
    );
  }

  function returnToConsentGate() {
    participationConsent = null;
    if (eligibilityConfirm) eligibilityConfirm.checked = false;
    if (consentConfirm) consentConfirm.checked = false;
    updateConsentButton();
    if (results) results.hidden = true;
    flow.hidden = false;
    if (footnote) footnote.hidden = false;
    if (surveyShell) surveyShell.hidden = true;
    if (participantGate) {
      participantGate.hidden = false;
      scrollElementIntoView(participantGate);
    }
    const resume = document.getElementById('survey-resume-banner');
    if (resume) resume.remove();
  }

  function startDeskAssessment(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!hasValidConsent()) return;
    try {
      if (results) results.hidden = true;
      flow.hidden = false;
      if (footnote) footnote.hidden = false;
      if (!state) resetState();
      goToStage(0);
      scrollElementIntoView(document.getElementById('survey') || flow);
    } catch (err) {
      const note = document.querySelector('.survey-fallback-note');
      if (note) {
        note.textContent =
          'The challenge could not start in this preview. Open http://localhost:5500/#survey in Chrome, Edge, or Firefox.';
      }
      if (typeof console !== 'undefined' && console.error) console.error(err);
    }
  }

  const startFallback = document.getElementById('survey-start-fallback');
  if (startFallback) {
    startFallback.addEventListener('click', startDeskAssessment);
  }

  flow.addEventListener('submit', (event) => event.preventDefault());

  function updateConsentButton() {
    if (!consentContinue) return;
    consentContinue.disabled = !(eligibilityConfirm?.checked && consentConfirm?.checked);
  }

  eligibilityConfirm?.addEventListener('change', updateConsentButton);
  consentConfirm?.addEventListener('change', updateConsentButton);
  consentContinue?.addEventListener('click', () => {
    if (!(eligibilityConfirm?.checked && consentConfirm?.checked)) return;
    participationConsent = {
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      consentedAt: new Date().toISOString(),
      adultEligibilityConfirmed: true,
      voluntaryParticipationConfirmed: true,
    };
    if (participantGate) participantGate.hidden = true;
    if (surveyShell) surveyShell.hidden = false;
    startDeskAssessment();
    offerResumeIfSaved();
  });

  try {
    purgeLegacyLocalData();
    resetState();
    updateConsentButton();
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) console.error(err);
    const note = document.querySelector('.survey-fallback-note');
    if (note) {
      note.textContent =
        'The challenge could not start automatically. Click “Unlock my profile”, or open this page in Chrome, Edge, or Firefox.';
    }
  }
})();
