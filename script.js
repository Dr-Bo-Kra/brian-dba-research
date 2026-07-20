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

(function initLendingDesk() {
  const flow = document.getElementById('survey-flow');
  if (!flow) return;

  const profileForm = document.getElementById('profile-form');
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
  const sfxToggle = document.getElementById('sfx-toggle');
  const outcomeToast = document.getElementById('outcome-toast');
  const decisionStamp = document.getElementById('decision-stamp');
  const decisionStampText = document.getElementById('decision-stamp-text');
  const carryoverNote = document.getElementById('carryover-note');
  const caseTimerEl = document.getElementById('case-timer');
  const caseTimerVal = document.getElementById('case-timer-val');
  const caseTimerBar = document.getElementById('case-timer-bar');
  const portraitEl = document.getElementById('borrower-portrait');
  const stakeTagEl = document.getElementById('stake-tag');
  const signalCostHint = document.getElementById('signal-cost-hint');
  const radarChartEl = document.getElementById('radar-chart');
  const playStyleTitle = document.getElementById('play-style-title');
  const playStyleBlurb = document.getElementById('play-style-blurb');
  const playBadgeMark = document.getElementById('play-badge-mark');
  const archiveStatusEl = document.getElementById('archive-status');

  const phaseProfile = document.getElementById('phase-profile');
  const phaseBriefing = document.getElementById('phase-briefing');
  const phasePlay = document.getElementById('phase-play');
  const phaseDebrief = document.getElementById('phase-debrief');

  const LATEST_KEY = 'brian-dba-survey-latest';
  const ARCHIVE_KEY = 'brian-dba-survey-responses';
  const INSTRUMENT = 'brian-dba-lending-desk-game-v2';
  const cfg = window.BRIAN_DBA_CONFIG || {};
  const SUPABASE_URL = String(cfg.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const SUPABASE_ANON_KEY = String(cfg.SUPABASE_ANON_KEY || '').trim();
  const archiveConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  const START_TOKENS = 6;
  const START_RISK = 100;
  const METER_START = { portfolioRisk: 22, inclusion: 50, governance: 50 };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const labels = {
    role: {
      'credit-officer': 'Credit / risk officer',
      underwriter: 'Underwriter / loan officer',
      'product-lead': 'Product / lending lead',
      executive: 'Executive / board',
      academic: 'Academic / researcher',
      policy: 'Policy / development finance',
      consultant: 'Consultant / advisor',
      other: 'Other',
    },
    institutionType: {
      bank: 'Bank / commercial lender',
      mfi: 'Microfinance institution',
      fintech: 'Fintech / digital lender',
      cooperative: 'Cooperative / credit union',
      nbfi: 'Non-bank financial institution',
      development: 'Development finance / NGO lender',
      university: 'University / research body',
      regulator: 'Regulator / policy body',
      other: 'Other / not applicable',
    },
    region: {
      'south-asia': 'South Asia',
      'southeast-asia': 'Southeast Asia',
      'other-asia': 'Other Asia–Pacific',
      africa: 'Africa',
      latam: 'Latin America & Caribbean',
      other: 'Other / global',
    },
    yearsExperience: {
      '0-2': '0–2 years',
      '3-5': '3–5 years',
      '6-10': '6–10 years',
      '11-15': '11–15 years',
      '16plus': '16+ years',
    },
    familiarity: {
      1: 'Not at all',
      2: 'Slightly',
      3: 'Moderately',
      4: 'Very',
      5: 'Extremely',
    },
    decision: {
      approve: 'Approved',
      decline: 'Declined',
      hold: 'Held for governance',
    },
  };

  const PORTRAITS = {
    amina: {
      bg: '#1a5c52',
      accent: '#b8e65a',
      paths:
        '<ellipse cx="50" cy="38" rx="16" ry="18" fill="#c48a5a"/><path d="M28 28c4-14 40-14 44 2 2 10-4 18-10 20-8 2-18 2-26-2-6-4-10-12-8-20z" fill="#2a1a12"/><path d="M34 78c2-16 14-24 16-24s14 8 16 24" fill="#27b5a5"/><circle cx="44" cy="38" r="1.6" fill="#1a120c"/><circle cx="56" cy="38" r="1.6" fill="#1a120c"/><path d="M45 48c2 2 8 2 10 0" stroke="#1a120c" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
    },
    ravi: {
      bg: '#1e3a55',
      accent: '#f3b64b',
      paths:
        '<ellipse cx="50" cy="40" rx="15" ry="17" fill="#d4a574"/><path d="M32 32c2-12 34-12 36 4v8c-4 6-12 8-18 8s-14-2-18-8v-12z" fill="#3d2918"/><path d="M35 78c1-14 12-22 15-22s14 8 15 22" fill="#092033"/><circle cx="44" cy="40" r="1.5" fill="#2a1a10"/><circle cx="56" cy="40" r="1.5" fill="#2a1a10"/><path d="M46 49h8" stroke="#2a1a10" stroke-width="1.2" stroke-linecap="round"/>',
    },
    sangha: {
      bg: '#2a3d28',
      accent: '#27b5a5',
      paths:
        '<circle cx="36" cy="42" r="11" fill="#c49a6c"/><circle cx="50" cy="36" r="12" fill="#b8895c"/><circle cx="64" cy="44" r="10" fill="#d4a878"/><path d="M24 78c4-18 18-26 26-26 6 0 14 4 20 14 2 4 4 12 4 12H24z" fill="#0e5360"/><circle cx="36" cy="40" r="1.2" fill="#2a1a10"/><circle cx="48" cy="34" r="1.3" fill="#2a1a10"/><circle cx="62" cy="42" r="1.1" fill="#2a1a10"/>',
    },
    fasttrack: {
      bg: '#3a2a18',
      accent: '#f3b64b',
      paths:
        '<ellipse cx="50" cy="39" rx="15" ry="17" fill="#c47a5a"/><path d="M30 30c6-12 34-12 40 4-2 8-8 14-14 16-8 2-18 1-24-4-4-4-6-10-2-16z" fill="#1a120c"/><path d="M34 78c2-15 13-23 16-23s14 8 16 23" fill="#102f3c"/><circle cx="44" cy="39" r="1.5" fill="#1a1008"/><circle cx="56" cy="39" r="1.5" fill="#1a1008"/><path d="M45 48c3 2.5 7 2.5 10 0" stroke="#1a1008" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
    },
    lin: {
      bg: '#243048',
      accent: '#8f7cf1',
      paths:
        '<ellipse cx="50" cy="40" rx="14" ry="16" fill="#e0b898"/><path d="M34 28c4-8 28-8 32 4v10c-2 8-10 12-16 12s-14-4-16-12V28z" fill="#1a1a1e"/><path d="M36 78c1-14 11-22 14-22s13 8 14 22" fill="#5c4db8"/><circle cx="44" cy="40" r="1.4" fill="#2a1a10"/><circle cx="56" cy="40" r="1.4" fill="#2a1a10"/><path d="M46 49c2 1.5 6 1.5 8 0" stroke="#2a1a10" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
    },
  };

  /**
   * Five borrower vignettes. Each encodes preferred signal use and decision quality
   * for scoring psychometric, social, behavioral, readiness, governance, and inclusion.
   */
  const CASES = [
    {
      id: 'amina',
      name: 'Amina Okoro',
      role: 'Informal market vendor · inventory top-up',
      tag: 'Thin-file',
      amount: 'USD 420',
      riskCost: 18,
      stake: 'Stake: peak-season stock vs household celebration cash.',
      story:
        'No formal credit history. She sells produce daily and asks for a short inventory loan before a busy season. She mentions needing cash “this week for the festival as well,” but the application is framed as working capital.',
      pressure: null,
      timed: false,
      signals: {
        psych:
          'Screening note: high self-discipline on prior savings habits; internal locus—“I plan stock around market days.” Mild tension with festival spending urge.',
        social:
          'Market association chair vouchers her; two peers offer informal monitoring. Strong community reputation, no formal collateral.',
        behavior:
          'Present-bias flag: festival framing competes with inventory use. Loss aversion to missing peak season is genuine; mental accounting may blur “business” vs “celebration” money.',
      },
      scoreHints: {
        preferSignals: ['social', 'behavior'],
        idealDecision: 'approve',
        badDecision: 'decline',
        governanceCase: false,
      },
    },
    {
      id: 'ravi',
      name: 'Ravi Mehta',
      role: 'Gig courier · personal top-up loan',
      tag: 'Near-file',
      amount: 'USD 900',
      riskCost: 28,
      stake: 'Stake: overconfidence vs volatile gig income.',
      story:
        'Irregular platform income. He insists he can “easily repay three times this amount” and wants the largest offer available today. Thin traditional statements; high verbal confidence.',
      pressure: null,
      timed: false,
      signals: {
        psych:
          'Self-efficacy claim is high, but past follow-through on goals is uneven. External locus when setbacks occur—“the algorithm cut my hours.”',
        social:
          'Few durable peer ties for repayment monitoring. Roommate will not co-sign. Weak community guarantee.',
        behavior:
          'Overconfidence under uncertainty: repayment capacity stated far above earnings volatility. Present bias toward larger loan now; loss-frame resistance to a smaller product.',
      },
      scoreHints: {
        preferSignals: ['behavior', 'psych'],
        idealDecision: 'decline',
        badDecision: 'approve',
        governanceCase: false,
      },
    },
    {
      id: 'sangha',
      name: 'River Bend Lending Circle',
      role: 'Five-member joint-liability group · microenterprise',
      tag: 'Group · thin-file',
      amount: 'USD 1,100',
      riskCost: 22,
      stake: 'Stake: peer monitoring as collateral substitute.',
      story:
        'A rural cooperative-linked circle seeks a group facility. Individual credit files are thin. Members propose weekly peer meetings and rotating internal accountability.',
      pressure: null,
      timed: false,
      signals: {
        psych:
          'Group average shows mixed individual self-control; two members score high on planning discipline.',
        social:
          'Dense network ties, mutual monitoring history, and village reputation score are strong. Prior informal ROSCA completed without default.',
        behavior:
          'Collective loss aversion may deter free-riding; slight mental accounting risk if one member treats the group pot as personal.',
      },
      scoreHints: {
        preferSignals: ['social'],
        idealDecision: 'approve',
        badDecision: 'decline',
        governanceCase: false,
      },
    },
    {
      id: 'fasttrack',
      name: 'Priya Nair · flagged rush file',
      role: 'Sole trader · digital onboarding',
      tag: 'Governance stress',
      amount: 'USD 650',
      riskCost: 20,
      stake: 'Stake: campaign speed vs consent and fairness trail.',
      story:
        'Application looks passable on sparse data. Consent language for alternative data scrapes is incomplete. A sales lead pings: “Approve in the next hour—campaign KPI.” Fairness audit trail is empty.',
      pressure:
        'Desk pressure: skip explainability notes and proceed without refreshed consent. Speed vs governance tradeoff.',
      timed: true,
      timerSeconds: 45,
      signals: {
        psych: 'Incomplete psych pack—borrower did not finish trait items after a rushed onboarding link.',
        social: 'No community reference collected; digital-only channel.',
        behavior:
          'Staff overconfidence bias: urgency framing encourages skipping checks. Borrower loss aversion to delay is being used to push throughput.',
      },
      scoreHints: {
        preferSignals: [],
        idealDecision: 'hold',
        badDecision: 'approve',
        governanceCase: true,
      },
    },
    {
      id: 'lin',
      name: 'Lin Wei',
      role: 'Home-based craftsperson · equipment upgrade',
      tag: 'Thin-file · strong intent',
      amount: 'USD 380',
      riskCost: 14,
      stake: 'Stake: delayed gratification vs thin traditional evidence.',
      story:
        'Saved for two years toward a small machine. No collateral, informal sales via messaging apps. Asks for a modest facility timed to a delayed purchase rather than an impulse buy.',
      pressure: null,
      timed: true,
      timerSeconds: 55,
      signals: {
        psych:
          'Clear delay-of-gratification pattern and internal locus of control. High discipline markers; repayment intent narrative is coherent.',
        social: 'Neighbor guild will mentor production quality; light reputation signal, not a full guarantee.',
        behavior:
          'Low present bias. Mental accounting is clean: equipment vs household cash. Confidence calibrated to past savings—not overstated.',
      },
      scoreHints: {
        preferSignals: ['psych'],
        idealDecision: 'approve',
        badDecision: 'decline',
        governanceCase: false,
      },
    },
  ];

  const domainsMeta = [
    {
      id: 'psychometric',
      label: 'Psychometric indicators',
      short: 'Psych',
      low: 'Limited use of trait signals—discipline, locus of control and self-efficacy rarely informed your desk decisions.',
      mid: 'Selective use of psychometric evidence—traits shaped some choices but were not systematically sought.',
      high: 'Strong practice of seeking and weighting psychometric cues (self-control, locus, efficacy) for thin-file judgment.',
    },
    {
      id: 'social',
      label: 'Social capital',
      short: 'Social',
      low: 'Community trust, peer monitoring and reputation carried little weight in how you unlocked signals or decided.',
      mid: 'Moderate reliance on networks and peer accountability when traditional collateral was thin.',
      high: 'Clear stance that social capital—trust, peers, reputation—can reduce information asymmetry in inclusive lending.',
    },
    {
      id: 'behavioral',
      label: 'Behavioral economics',
      short: 'Behavior',
      low: 'Present bias, overconfidence and related biases rarely shaped interpretation or product caution.',
      mid: 'Some recognition of behavioral red flags, with room to embed them more consistently under uncertainty.',
      high: 'Consistent detection of present bias, overconfidence and framing—using behavior to temper or structure decisions.',
    },
    {
      id: 'readiness',
      label: 'Organizational readiness',
      short: 'Ready',
      low: 'Process looked ad hoc: little integrated signal use or disciplined budget/token management under desk constraints.',
      mid: 'Mixed operational discipline—interest in alternative evidence with uneven process rigor.',
      high: 'Behaved like a ready desk: budgeted information, combined signal types, and structured decisions under constraint.',
    },
    {
      id: 'governance',
      label: 'Ethical governance & inclusion',
      short: 'Ethics',
      low: 'Speed or throughput often beat consent, fairness and explainability—or inclusion for evidence-backed thin-files lagged.',
      mid: 'Supports safeguards and fair access in places; governance habits may still need strengthening under pressure.',
      high: 'Strong responsible orientation: ethics holds when pressured, and alternatives used to expand fair access—not only to exclude.',
    },
  ];

  let profile = {};
  let state = null;
  let latestRecord = null;
  let caseStartedAt = 0;
  let deciding = false;
  let timerId = null;
  let timerRemaining = 0;
  let timerTotal = 0;
  let softTimerActive = false;
  let audioCtx = null;
  let sfxEnabled = false;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function mean(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function levelFor(score) {
    if (score >= 4) return { id: 'strong', label: 'Strong alignment' };
    if (score >= 3) return { id: 'moderate', label: 'Moderate alignment' };
    return { id: 'cautious', label: 'Cautious / skeptical' };
  }

  function interpretDomain(meta, score) {
    if (score >= 4) return meta.high;
    if (score >= 3) return meta.mid;
    return meta.low;
  }

  function clearErrors(root) {
    root.querySelectorAll('.field-error').forEach((el) => {
      el.hidden = true;
    });
    root.querySelectorAll('.field.invalid').forEach((el) => el.classList.remove('invalid'));
  }

  function showError(name) {
    const error = document.getElementById(`error-${name}`);
    const field = error?.closest('.field');
    if (error) error.hidden = false;
    if (field) field.classList.add('invalid');
  }

  function validateProfile() {
    clearErrors(profileForm);
    let valid = true;
    profileForm.querySelectorAll('select[required]').forEach((select) => {
      if (!select.value) {
        valid = false;
        showError(select.name);
      }
    });
    const fam = [...profileForm.querySelectorAll('input[name="familiarity"]')];
    if (!fam.some((r) => r.checked)) {
      valid = false;
      showError('familiarity');
    }
    return valid;
  }

  function collectProfile() {
    const fd = new FormData(profileForm);
    return {
      role: String(fd.get('role') || ''),
      institutionType: String(fd.get('institutionType') || ''),
      region: String(fd.get('region') || ''),
      yearsExperience: String(fd.get('yearsExperience') || ''),
      familiarity: String(fd.get('familiarity') || ''),
    };
  }

  /* —— Web Audio SFX (muted by default) —— */
  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, dur, type, gainVal, when) {
    const ctx = ensureAudio();
    if (!ctx || !sfxEnabled || reduceMotion) return;
    const t0 = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainVal, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playSfx(kind) {
    if (!sfxEnabled || reduceMotion) return;
    if (!ensureAudio()) return;
    const ctx = audioCtx;
    const t = ctx.currentTime;
    if (kind === 'token') {
      tone(880, 0.08, 'triangle', 0.04, t);
      tone(1320, 0.06, 'sine', 0.025, t + 0.05);
    } else if (kind === 'stamp') {
      tone(180, 0.12, 'square', 0.035, t);
      tone(90, 0.18, 'sine', 0.04, t + 0.04);
    } else if (kind === 'tick') {
      tone(640, 0.04, 'square', 0.018, t);
    } else if (kind === 'chime') {
      tone(523, 0.14, 'sine', 0.04, t);
      tone(659, 0.16, 'sine', 0.035, t + 0.1);
      tone(784, 0.22, 'sine', 0.03, t + 0.2);
    } else if (kind === 'warn') {
      tone(420, 0.07, 'triangle', 0.03, t);
    }
  }

  function updateSfxToggleUi() {
    if (!sfxToggle) return;
    sfxToggle.setAttribute('aria-pressed', String(sfxEnabled));
    sfxToggle.setAttribute(
      'aria-label',
      sfxEnabled ? 'Sound effects on. Activate to mute.' : 'Sound effects muted. Activate to unmute.'
    );
    const icon = sfxToggle.querySelector('.sfx-toggle-icon');
    const text = sfxToggle.querySelector('.sfx-toggle-text');
    if (icon) icon.textContent = sfxEnabled ? '♪' : '–';
    if (text) text.textContent = sfxEnabled ? 'Sound on' : 'Sound off';
  }

  function showPhase(name) {
    phaseProfile.hidden = name !== 'profile';
    phaseBriefing.hidden = name !== 'briefing';
    phasePlay.hidden = name !== 'play';
    phaseDebrief.hidden = name !== 'debrief';
    updateProgress(name);
  }

  function updateProgress(phase) {
    const map = {
      profile: { label: 'Profile', pct: 5 },
      briefing: { label: 'Briefing', pct: 15 },
      play: {
        label: `Desk case ${(state?.caseIndex ?? 0) + 1} of ${CASES.length}`,
        pct: 15 + Math.round(((state?.caseIndex ?? 0) / CASES.length) * 70),
      },
      debrief: { label: 'Reflection', pct: 92 },
      results: { label: 'Assessment complete', pct: 100 },
    };
    const m = map[phase] || map.profile;
    progressLabel.textContent = m.label;
    progressPct.textContent = `${m.pct}% complete`;
    progressBar.style.width = `${m.pct}%`;
  }

  function resetGameState() {
    state = {
      tokens: START_TOKENS,
      risk: START_RISK,
      caseIndex: 0,
      unlocked: { psych: false, social: false, behavior: false },
      meters: { ...METER_START },
      signalCost: 1,
      riskMultiplier: 1,
      plays: [],
      carryoverFlags: [],
      startedAt: new Date().toISOString(),
    };
  }

  function currentSignalCost() {
    return state?.signalCost ?? 1;
  }

  function applyCarryoverRules() {
    if (!state) return;
    const m = state.meters;
    let cost = 1;
    let note = '';
    let riskMultiplier = 1;

    if (m.portfolioRisk >= 70) {
      cost = Math.max(cost, 2);
      riskMultiplier = 1.25;
      note = 'Carryover: elevated portfolio risk — signal unlocks cost 2 tokens; approvals burn more budget.';
    }
    if (m.governance < 35) {
      cost = Math.max(cost, 2);
      note = note
        ? `${note} Governance strain also raises unlock cost.`
        : 'Carryover: governance strain — signal unlocks cost 2 tokens until ethics recover.';
    }
    if (m.inclusion < 35 && state.caseIndex >= 2) {
      note = note
        ? `${note} Inclusion meter is low — thin-file declines will deepen exclusion signals.`
        : 'Carryover: inclusion is soft — evidence-backed approvals can still recover the meter.';
    }
    if (m.governance >= 70 && m.portfolioRisk < 55) {
      riskMultiplier = Math.min(riskMultiplier, 0.9);
      if (!note) note = 'Carryover: strong governance posture — approval risk burn eased slightly.';
    }
    if (state.risk < 30 && !note) {
      note = 'Carryover: risk budget is thin — further approvals will constrain the remaining queue.';
    }
    if (m.portfolioRisk >= 80) {
      note = 'Carryover: critical portfolio risk — blind approvals are blocked until you unlock at least one signal.';
    }

    state.signalCost = cost;
    state.riskMultiplier = riskMultiplier;
    state.carryoverNote = note;

    if (carryoverNote) {
      if (note) {
        carryoverNote.hidden = false;
        carryoverNote.textContent = note;
      } else {
        carryoverNote.hidden = true;
        carryoverNote.textContent = '';
      }
    }

    if (signalCostHint) {
      signalCostHint.textContent = cost === 1 ? '(1 token each)' : `(${cost} tokens each — carryover)`;
    }
    document.querySelectorAll('[data-cost-label]').forEach((el) => {
      el.textContent = cost === 1 ? '1 token' : `${cost} tokens`;
    });
  }

  function updateLiveMeters(flash) {
    if (!state) return;
    const { portfolioRisk, inclusion, governance } = state.meters;
    const riskVal = document.getElementById('meter-risk-val');
    const inclVal = document.getElementById('meter-incl-val');
    const govVal = document.getElementById('meter-gov-val');
    const riskBar = document.getElementById('meter-risk-bar');
    const inclBar = document.getElementById('meter-incl-bar');
    const govBar = document.getElementById('meter-gov-bar');
    if (riskVal) riskVal.textContent = String(Math.round(portfolioRisk));
    if (inclVal) inclVal.textContent = String(Math.round(inclusion));
    if (govVal) govVal.textContent = String(Math.round(governance));
    if (riskBar) riskBar.style.width = `${portfolioRisk}%`;
    if (inclBar) inclBar.style.width = `${inclusion}%`;
    if (govBar) govBar.style.width = `${governance}%`;

    if (flash && !reduceMotion) {
      document.querySelectorAll('.live-meter').forEach((el) => {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      });
    }
  }

  function updateHud() {
    document.getElementById('hud-case').textContent = `${state.caseIndex + 1} / ${CASES.length}`;
    document.getElementById('hud-tokens').textContent = String(state.tokens);
    document.getElementById('hud-risk').textContent = String(Math.round(state.risk));
    document.getElementById('hud-tokens-bar').style.width = `${(state.tokens / START_TOKENS) * 100}%`;
    document.getElementById('hud-risk-bar').style.width = `${(state.risk / START_RISK) * 100}%`;

    const cost = currentSignalCost();
    ['psych', 'social', 'behavior'].forEach((key) => {
      const btn = document.getElementById(`btn-signal-${key}`);
      if (!btn || state.unlocked[key]) return;
      btn.disabled = state.tokens < cost;
      btn.classList.toggle('spent', state.tokens < cost);
    });

    // Blind approve block under critical risk
    const approveBtn = document.getElementById('btn-approve');
    if (approveBtn) {
      const blindBlocked =
        state.meters.portfolioRisk >= 80 &&
        !state.unlocked.psych &&
        !state.unlocked.social &&
        !state.unlocked.behavior;
      approveBtn.disabled = blindBlocked;
      approveBtn.title = blindBlocked
        ? 'Portfolio risk is critical — unlock at least one signal before approving.'
        : '';
    }
  }

  function renderPortrait(caseId) {
    const p = PORTRAITS[caseId] || PORTRAITS.amina;
    portraitEl.innerHTML = `<svg viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false">
      <rect width="100" height="100" fill="${p.bg}"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="${p.accent}" stroke-width="1.5" opacity=".45"/>
      ${p.paths}
    </svg>`;
  }

  function clearTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    softTimerActive = false;
    if (caseTimerEl) {
      caseTimerEl.hidden = true;
      caseTimerEl.classList.remove('urgent');
    }
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function startSoftTimer(seconds) {
    clearTimer();
    softTimerActive = true;
    timerTotal = seconds;
    timerRemaining = seconds;
    state.timerTimedOut = false;
    caseTimerEl.hidden = false;
    caseTimerVal.textContent = formatTime(timerRemaining);
    caseTimerBar.style.width = '100%';

    timerId = setInterval(() => {
      timerRemaining -= 1;
      if (timerRemaining <= 0) {
        timerRemaining = 0;
        state.timerTimedOut = true;
        caseTimerVal.textContent = '0:00';
        caseTimerBar.style.width = '0%';
        caseTimerEl.classList.add('urgent');
        playSfx('warn');
        clearInterval(timerId);
        timerId = null;
        return;
      }
      caseTimerVal.textContent = formatTime(timerRemaining);
      caseTimerBar.style.width = `${(timerRemaining / timerTotal) * 100}%`;
      if (timerRemaining <= 10) {
        caseTimerEl.classList.add('urgent');
        if (timerRemaining <= 8 && timerRemaining % 2 === 0) playSfx('tick');
      }
    }, 1000);
  }

  function renderCase() {
    const c = CASES[state.caseIndex];
    state.unlocked = { psych: false, social: false, behavior: false };
    state.timerTimedOut = false;
    caseStartedAt = performance.now();
    deciding = false;

    applyCarryoverRules();
    renderPortrait(c.id);

    document.getElementById('case-tag').textContent = c.tag;
    document.getElementById('case-amount').textContent = c.amount;
    document.getElementById('case-title').textContent = c.name;
    document.getElementById('case-role').textContent = c.role;
    document.getElementById('case-story').textContent = c.story;
    if (stakeTagEl) stakeTagEl.textContent = c.stake || '';

    const pressure = document.getElementById('case-pressure');
    if (c.pressure) {
      pressure.hidden = false;
      pressure.textContent = c.pressure;
    } else {
      pressure.hidden = true;
      pressure.textContent = '';
    }

    const reveals = document.getElementById('signal-reveals');
    reveals.innerHTML = '';

    ['psych', 'social', 'behavior'].forEach((key) => {
      const btn = document.getElementById(`btn-signal-${key}`);
      btn.disabled = false;
      btn.classList.remove('unlocked', 'spent');
    });
    document.getElementById('btn-approve').disabled = false;
    document.getElementById('btn-approve').title = '';

    document.getElementById('error-decision').hidden = true;
    document.getElementById('error-decision').textContent = 'Choose a decision to continue.';
    if (decisionStamp) {
      decisionStamp.hidden = true;
      decisionStamp.classList.remove('show', 'approve', 'hold', 'decline');
    }
    if (outcomeToast) {
      outcomeToast.hidden = true;
      outcomeToast.classList.remove('show');
    }

    updateLiveMeters(false);
    updateHud();
    updateProgress('play');

    clearTimer();
    // Soft timer: always on Priya; Lin only if governance already strained (carryover)
    const useTimer = c.timed && (c.id === 'fasttrack' || state.meters.governance < 45);
    if (useTimer) {
      const secs = c.timerSeconds || 45;
      // slightly shorter if governance already low on Priya
      const adjusted =
        c.id === 'fasttrack' && state.meters.governance < 40 ? Math.max(30, secs - 10) : secs;
      startSoftTimer(adjusted);
    }

    const card = document.getElementById('case-card');
    card.classList.remove('case-enter');
    void card.offsetWidth;
    if (!reduceMotion) card.classList.add('case-enter');

    // Keep keyboard shortcuts available inside the desk stage
    const stage = document.getElementById('desk-stage');
    if (stage && !stage.hasAttribute('tabindex')) stage.setAttribute('tabindex', '-1');
    stage?.focus({ preventScroll: true });
  }

  function unlockSignal(type) {
    if (state.unlocked[type] || deciding) return;
    const cost = currentSignalCost();
    if (state.tokens < cost) {
      const reveals = document.getElementById('signal-reveals');
      let note = reveals.querySelector('.token-warn');
      if (!note) {
        note = document.createElement('p');
        note.className = 'token-warn';
        note.textContent =
          cost > 1
            ? `Need ${cost} tokens (carryover cost). Decide with what you have—or use governance hold if the file is incomplete.`
            : 'No information tokens left. Decide with what you have—or use governance hold if the file is incomplete.';
        reveals.prepend(note);
      }
      playSfx('warn');
      return;
    }

    state.tokens -= cost;
    state.unlocked[type] = true;
    const btn = document.getElementById(`btn-signal-${type}`);
    btn.disabled = true;
    btn.classList.add('unlocked');

    const c = CASES[state.caseIndex];
    const labelsMap = { psych: 'Psychometric', social: 'Community', behavior: 'Behavioral' };
    const reveals = document.getElementById('signal-reveals');
    const block = document.createElement('div');
    block.className = `signal-reveal ${type}`;
    block.innerHTML = `<strong>${labelsMap[type]} signal</strong><p>${c.signals[type]}</p>`;
    reveals.append(block);
    playSfx('token');
    updateHud();
  }

  function meterDeltaForDecision(c, decision, unlockedList) {
    const deltas = { portfolioRisk: 0, inclusion: 0, governance: 0 };
    const hadEvidence = unlockedList.length > 0;
    const ideal = c.scoreHints.idealDecision;
    const bad = c.scoreHints.badDecision;

    if (decision === 'approve') {
      deltas.portfolioRisk += c.scoreHints.governanceCase ? 18 : hadEvidence ? 6 : 12;
      if (c.id === 'ravi') deltas.portfolioRisk += hadEvidence ? 10 : 16;
      if (['amina', 'lin', 'sangha'].includes(c.id)) {
        deltas.inclusion += hadEvidence ? 12 : 6;
        deltas.governance += hadEvidence ? 4 : 1;
      }
      if (c.scoreHints.governanceCase) {
        deltas.governance -= 18;
        deltas.inclusion += 2;
      }
      if (decision === bad) deltas.governance -= 4;
    } else if (decision === 'decline') {
      deltas.portfolioRisk -= 4;
      if (['amina', 'lin', 'sangha'].includes(c.id)) {
        deltas.inclusion -= hadEvidence ? 10 : 6;
      }
      if (c.id === 'ravi') {
        deltas.governance += 8;
        deltas.portfolioRisk -= 6;
        deltas.inclusion += 2;
      }
      if (c.scoreHints.governanceCase) deltas.governance += 4;
    } else if (decision === 'hold') {
      deltas.governance += c.scoreHints.governanceCase ? 16 : 6;
      deltas.portfolioRisk -= 2;
      if (['amina', 'lin', 'sangha'].includes(c.id) && hadEvidence) {
        deltas.inclusion += 2;
      }
    }

    if (decision === ideal) {
      if (ideal === 'approve') deltas.inclusion += 2;
      if (ideal === 'hold') deltas.governance += 2;
      if (ideal === 'decline') deltas.portfolioRisk -= 2;
    }

    if (state.timerTimedOut && c.scoreHints.governanceCase && decision === 'approve') {
      deltas.governance -= 4;
    }
    if (state.timerTimedOut && c.id === 'lin' && decision === 'decline') {
      deltas.inclusion -= 2;
    }

    return deltas;
  }

  function feedbackChips(deltas, decision, c) {
    const chips = [];
    if (deltas.portfolioRisk > 3) chips.push({ t: 'Risk ↑', cls: 'down' });
    else if (deltas.portfolioRisk < -2) chips.push({ t: 'Risk ↓', cls: 'up' });
    if (deltas.inclusion > 3) chips.push({ t: 'Inclusion ↑', cls: 'up' });
    else if (deltas.inclusion < -3) chips.push({ t: 'Inclusion ↓', cls: 'down' });
    if (deltas.governance > 3) chips.push({ t: 'Governance ↑', cls: 'up' });
    else if (deltas.governance < -3) chips.push({ t: 'Ethics ↓', cls: 'down' });

    if (decision === 'approve' && c.id === 'sangha') chips.push({ t: 'Peer trust secured', cls: 'up' });
    if (decision === 'hold' && c.scoreHints.governanceCase) chips.push({ t: 'Consent pause', cls: 'up' });
    if (decision === 'decline' && c.id === 'ravi') chips.push({ t: 'Overconfidence checked', cls: 'up' });
    if (decision === 'approve' && c.id === 'ravi') chips.push({ t: 'Exposure added', cls: 'down' });
    if (decision === 'approve' && !Object.values(state.unlocked).some(Boolean) && !c.scoreHints.governanceCase) {
      chips.push({ t: 'Thin evidence', cls: 'down' });
    }
    if (state.timerTimedOut) chips.push({ t: 'Soft timeout noted', cls: 'down' });
    return chips;
  }

  function feedbackMessage(decision, c, deltas) {
    if (decision === 'approve') {
      if (c.scoreHints.governanceCase) return 'Approved under governance stress — ethics meter takes the hit.';
      if (c.id === 'ravi') return 'Approved the overconfident file — portfolio risk rises.';
      if (c.id === 'sangha') return 'Group facility approved — peer monitoring credited toward inclusion.';
      if (c.id === 'lin') return 'Modest facility approved — discipline signal supports inclusion.';
      return 'Approval logged — risk budget spent; meters updated.';
    }
    if (decision === 'hold') {
      if (c.scoreHints.governanceCase) return 'Held for governance — consent and fairness trail protected.';
      return 'Held for review — slower path, stronger process signal.';
    }
    if (c.id === 'ravi') return 'Declined — behavioral caution preserved portfolio capacity.';
    if (['amina', 'lin', 'sangha'].includes(c.id)) return 'Declined a thin-file — inclusion meter softens.';
    return 'Decline logged — risk budget preserved.';
  }

  function showStamp(decision) {
    if (!decisionStamp) return;
    const map = { approve: 'APPROVED', hold: 'ON HOLD', decline: 'DECLINED' };
    decisionStampText.textContent = map[decision] || decision.toUpperCase();
    decisionStamp.classList.remove('show', 'approve', 'hold', 'decline');
    decisionStamp.classList.add(decision);
    decisionStamp.hidden = false;
    void decisionStamp.offsetWidth;
    decisionStamp.classList.add('show');
    playSfx('stamp');
  }

  function showToast(message, chips) {
    if (!outcomeToast) return;
    const chipsHtml = chips
      .map((c) => `<span class="toast-chip ${c.cls}">${c.t}</span>`)
      .join('');
    outcomeToast.innerHTML = `<strong>Case outcome</strong> — ${message}<div class="toast-chips">${chipsHtml}</div>`;
    outcomeToast.hidden = false;
    outcomeToast.classList.remove('show');
    void outcomeToast.offsetWidth;
    outcomeToast.classList.add('show');
    playSfx('chime');
  }

  function decide(decision) {
    if (deciding) return;
    const c = CASES[state.caseIndex];
    const unlockedList = Object.keys(state.unlocked).filter((k) => state.unlocked[k]);

    // Critical risk: block blind approve
    if (
      decision === 'approve' &&
      state.meters.portfolioRisk >= 80 &&
      unlockedList.length === 0
    ) {
      document.getElementById('error-decision').hidden = false;
      document.getElementById('error-decision').textContent =
        'Portfolio risk is critical — unlock at least one signal before approving.';
      playSfx('warn');
      return;
    }

    deciding = true;
    const usedSoftTimer = softTimerActive || Boolean(state.timerTimedOut);
    clearTimer();

    const elapsedMs = Math.round(performance.now() - caseStartedAt);
    const timedOut = Boolean(state.timerTimedOut);
    let riskSpent = 0;

    if (decision === 'approve') {
      riskSpent = Math.round(c.riskCost * (state.riskMultiplier || 1));
      state.risk = Math.max(0, state.risk - riskSpent);
    }

    const deltas = meterDeltaForDecision(c, decision, unlockedList);
    state.meters.portfolioRisk = clamp(state.meters.portfolioRisk + deltas.portfolioRisk, 0, 100);
    state.meters.inclusion = clamp(state.meters.inclusion + deltas.inclusion, 0, 100);
    state.meters.governance = clamp(state.meters.governance + deltas.governance, 0, 100);

    state.plays.push({
      caseId: c.id,
      caseName: c.name,
      decision,
      unlocked: unlockedList,
      unlockedPsych: state.unlocked.psych,
      unlockedSocial: state.unlocked.social,
      unlockedBehavior: state.unlocked.behavior,
      riskAfter: state.risk,
      tokensAfter: state.tokens,
      elapsedMs,
      timedOut,
      softTimerUsed: usedSoftTimer,
      signalCostPaid: currentSignalCost(),
      riskSpent,
      metersAfter: { ...state.meters },
      meterDeltas: { ...deltas },
      riskCostIfApproved: c.riskCost,
      governanceCase: c.scoreHints.governanceCase,
      idealDecision: c.scoreHints.idealDecision,
      preferSignals: c.scoreHints.preferSignals,
    });

    updateLiveMeters(true);
    updateHud();
    showStamp(decision);
    const chips = feedbackChips(deltas, decision, c);
    showToast(feedbackMessage(decision, c, deltas), chips);

    const pause = reduceMotion ? 650 : 1450;
    setTimeout(() => {
      if (state.caseIndex < CASES.length - 1) {
        state.caseIndex += 1;
        renderCase();
        phasePlay.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      } else {
        showPhase('debrief');
        document.getElementById('survey-comment')?.focus({ preventScroll: true });
      }
      deciding = false;
    }, pause);
  }

  function derivePlayStyle(plays, assessment) {
    const byId = Object.fromEntries(plays.map((p) => [p.caseId, p]));
    const gov = assessment.domains.find((d) => d.id === 'governance')?.score ?? 3;
    const ready = assessment.domains.find((d) => d.id === 'readiness')?.score ?? 3;
    const social = assessment.domains.find((d) => d.id === 'social')?.score ?? 3;
    const behav = assessment.domains.find((d) => d.id === 'behavioral')?.score ?? 3;
    const psych = assessment.domains.find((d) => d.id === 'psychometric')?.score ?? 3;
    const overall = assessment.overall.score;

    const fast = byId.fasttrack;
    const heldGov = fast?.decision === 'hold';
    const approvedRush = fast?.decision === 'approve';
    const inclusives = ['amina', 'lin', 'sangha'].filter((id) => byId[id]?.decision === 'approve').length;
    const signalHeavy = plays.reduce((n, p) => n + p.unlocked.length, 0) >= 7;
    const timeouts = plays.filter((p) => p.timedOut).length;

    if (heldGov && gov >= 4 && overall >= 3.6) {
      return {
        id: 'governance-guardian',
        mark: 'GG',
        title: 'Governance guardian',
        blurb:
          'You protected consent and explainability under rush pressure while still engaging alternative signals—closest to a responsible desk posture.',
      };
    }
    if (inclusives >= 2 && social >= 3.8 && !approvedRush) {
      return {
        id: 'inclusion-builder',
        mark: 'IB',
        title: 'Inclusion builder',
        blurb:
          'You used community and thin-file evidence to expand access without abandoning ethical holds—inclusion with guardrails.',
      };
    }
    if (behav >= 4 && byId.ravi?.decision === 'decline') {
      return {
        id: 'bias-spotter',
        mark: 'BS',
        title: 'Bias spotter',
        blurb:
          'Behavioral red flags shaped your caution—especially overconfidence and present bias—keeping portfolio risk in check.',
      };
    }
    if (signalHeavy && ready >= 3.5) {
      return {
        id: 'signal-scout',
        mark: 'SS',
        title: 'Signal scout',
        blurb:
          'You spent tokens to triangulate psychometric, social and behavioral cues—operational curiosity that mirrors organizational readiness.',
      };
    }
    if (psych >= 4 && byId.lin?.decision === 'approve') {
      return {
        id: 'trait-reader',
        mark: 'TR',
        title: 'Trait-informed lender',
        blurb:
          'Discipline and locus-of-control cues mattered at your desk—psychometric evidence helped unlock careful inclusion.',
      };
    }
    if (approvedRush || (overall < 3 && inclusives <= 1)) {
      return {
        id: 'throughput-driver',
        mark: 'TD',
        title: 'Throughput-leaning desk',
        blurb:
          'Speed or traditional thin-file caution dominated. The research asks how institutions can rebalance throughput with governance and alternative evidence.',
      };
    }
    if (timeouts >= 1 && gov < 3.5) {
      return {
        id: 'pressure-reactive',
        mark: 'PR',
        title: 'Pressure-reactive officer',
        blurb:
          'Soft time pressure left a mark on the record. Under urgency, process habits matter as much as the decision itself.',
      };
    }
    return {
      id: 'balanced-desk',
      mark: 'BD',
      title: 'Balanced desk officer',
      blurb:
        'A mixed responsible stance: some alternative-signal use, some caution. Stronger integration of evidence, ethics and inclusion is the growth edge.',
    };
  }

  /**
   * Map play telemetry → 1–5 domain scores (same scale as prior Likert instrument).
   */
  function scoreFromPlays(plays) {
    let psychPts = [];
    let socialPts = [];
    let behavPts = [];
    let readyPts = [];
    let govPts = [];

    const byId = Object.fromEntries(plays.map((p) => [p.caseId, p]));

    const lin = byId.lin;
    if (lin) {
      if (lin.unlockedPsych && lin.decision === 'approve') psychPts.push(5);
      else if (lin.unlockedPsych && lin.decision === 'hold') psychPts.push(4);
      else if (lin.decision === 'approve') psychPts.push(3.2);
      else if (lin.decision === 'decline') psychPts.push(lin.unlockedPsych ? 2.2 : 1.8);
      else psychPts.push(2.8);
      if (lin.timedOut && lin.decision === 'decline') psychPts.push(2.4);
    }
    const ravi = byId.ravi;
    if (ravi) {
      if (ravi.unlockedPsych || ravi.unlockedBehavior) {
        if (ravi.decision === 'decline') psychPts.push(4.4);
        else if (ravi.decision === 'hold') psychPts.push(3.8);
        else psychPts.push(2.0);
      } else {
        psychPts.push(ravi.decision === 'decline' ? 3.0 : 2.2);
      }
    }
    const amina = byId.amina;
    if (amina?.unlockedPsych) psychPts.push(amina.decision === 'approve' ? 4.2 : 3.5);

    const sangha = byId.sangha;
    if (sangha) {
      if (sangha.unlockedSocial && sangha.decision === 'approve') socialPts.push(5);
      else if (sangha.unlockedSocial && sangha.decision === 'hold') socialPts.push(4);
      else if (sangha.decision === 'approve') socialPts.push(3.3);
      else if (sangha.decision === 'decline') socialPts.push(sangha.unlockedSocial ? 2.0 : 1.6);
      else socialPts.push(2.8);
    }
    if (amina) {
      if (amina.unlockedSocial && amina.decision === 'approve') socialPts.push(4.8);
      else if (amina.unlockedSocial) socialPts.push(3.6);
      else if (amina.decision === 'approve') socialPts.push(3.0);
      else socialPts.push(2.2);
    }
    if (ravi && ravi.unlockedSocial && ravi.decision === 'approve') {
      socialPts.push(2.0);
    } else if (ravi?.unlockedSocial && ravi.decision === 'decline') {
      socialPts.push(3.8);
    }

    if (ravi) {
      if (ravi.unlockedBehavior && ravi.decision === 'decline') behavPts.push(5);
      else if (ravi.unlockedBehavior && ravi.decision === 'hold') behavPts.push(4.2);
      else if (ravi.decision === 'decline') behavPts.push(3.4);
      else if (ravi.decision === 'approve' && !ravi.unlockedBehavior) behavPts.push(1.6);
      else behavPts.push(2.4);
    }
    if (amina) {
      if (amina.unlockedBehavior && amina.decision === 'approve') behavPts.push(4.5);
      else if (amina.unlockedBehavior && amina.decision === 'hold') behavPts.push(4.0);
      else if (amina.unlockedBehavior && amina.decision === 'decline') behavPts.push(3.2);
      else behavPts.push(2.8);
    }
    const fast = byId.fasttrack;
    if (fast?.unlockedBehavior && fast.decision === 'hold') behavPts.push(4.0);

    const unlockCounts = plays.map((p) => p.unlocked.length);
    const multiSignalCases = unlockCounts.filter((n) => n >= 2).length;
    const zeroSignalApprovals = plays.filter(
      (p) => p.decision === 'approve' && p.unlocked.length === 0 && !p.governanceCase
    ).length;
    const tokensLeft = plays.length ? plays[plays.length - 1].tokensAfter : START_TOKENS;
    const tokensSpent = START_TOKENS - tokensLeft;

    let readyScore = 3;
    readyScore += multiSignalCases * 0.35;
    readyScore -= zeroSignalApprovals * 0.55;
    if (tokensSpent >= 3 && tokensSpent <= 6) readyScore += 0.45;
    if (tokensSpent === 0) readyScore -= 0.8;
    if (tokensSpent === START_TOKENS && zeroSignalApprovals === 0) readyScore += 0.2;
    const usedPsych = plays.some((p) => p.unlockedPsych);
    const usedSocial = plays.some((p) => p.unlockedSocial);
    const usedBehav = plays.some((p) => p.unlockedBehavior);
    const domainsUsed = [usedPsych, usedSocial, usedBehav].filter(Boolean).length;
    readyScore += (domainsUsed - 1) * 0.35;
    // Carryover adaptation: if signal cost rose and player still unlocked, credit readiness
    if (plays.some((p) => (p.signalCostPaid || 1) > 1 && p.unlocked.length > 0)) readyScore += 0.25;
    readyPts.push(clamp(readyScore, 1, 5));

    let preferHits = 0;
    let preferTotal = 0;
    plays.forEach((p) => {
      const hints = CASES.find((c) => c.id === p.caseId)?.scoreHints;
      if (!hints?.preferSignals?.length) return;
      preferTotal += 1;
      if (hints.preferSignals.some((s) => p.unlocked.includes(s))) {
        preferHits += 1;
      }
    });
    if (preferTotal) {
      readyPts.push(1 + (preferHits / preferTotal) * 4);
    }

    if (fast) {
      if (fast.decision === 'hold') govPts.push(5);
      else if (fast.decision === 'decline') govPts.push(3.6);
      else govPts.push(1.5);
      // Soft timeout: mild penalty only if approved after timeout
      if (fast.timedOut && fast.decision === 'approve') govPts.push(1.8);
      else if (fast.timedOut && fast.decision === 'hold') govPts.push(4.4);
    }
    ['amina', 'lin', 'sangha'].forEach((id) => {
      const p = byId[id];
      if (!p) return;
      const hadEvidence = p.unlocked.length > 0;
      if (p.decision === 'approve' && hadEvidence) govPts.push(4.6);
      else if (p.decision === 'approve') govPts.push(3.4);
      else if (p.decision === 'hold' && hadEvidence) govPts.push(3.8);
      else if (p.decision === 'decline' && hadEvidence) govPts.push(2.2);
      else govPts.push(2.0);
    });
    if (ravi?.decision === 'decline') govPts.push(4.2);
    else if (ravi?.decision === 'approve') govPts.push(2.0);

    // Final meter alignment bonus (live meters → telemetry integrity)
    const lastMeters = plays.length ? plays[plays.length - 1].metersAfter : METER_START;
    if (lastMeters) {
      if (lastMeters.governance >= 65) govPts.push(4.3);
      if (lastMeters.inclusion >= 60) govPts.push(4.0);
      if (lastMeters.portfolioRisk >= 75) govPts.push(2.2);
    }

    const pack = (id, pts) => {
      const meta = domainsMeta.find((d) => d.id === id);
      const score = Number(clamp(mean(pts.length ? pts : [2.5]), 1, 5).toFixed(2));
      const level = levelFor(score);
      return {
        id,
        label: meta.label,
        score,
        max: 5,
        percent: Math.round((score / 5) * 100),
        level: level.id,
        levelLabel: level.label,
        interpretation: interpretDomain(meta, score),
        signalPoints: pts.map((n) => Number(n.toFixed(2))),
      };
    };

    const domainResults = [
      pack('psychometric', psychPts),
      pack('social', socialPts),
      pack('behavioral', behavPts),
      pack('readiness', readyPts),
      pack('governance', govPts),
    ];

    const overallScore = Number(mean(domainResults.map((d) => d.score)).toFixed(2));
    const overallLevel = levelFor(overallScore);
    const strongest = [...domainResults].sort((a, b) => b.score - a.score)[0];
    const weakest = [...domainResults].sort((a, b) => a.score - b.score)[0];
    const gov = domainResults.find((d) => d.id === 'governance');
    const ready = domainResults.find((d) => d.id === 'readiness');

    let summaryText =
      'Your play suggests a measured orientation toward alternative creditworthiness signals for responsible inclusive lending.';
    if (overallScore >= 4 && gov.score >= 4) {
      summaryText =
        'You combined alternative signals with ethical holds and inclusive approvals—close to the research’s responsible inclusive lending proposition.';
    } else if (overallScore >= 4 && gov.score < 3.5) {
      summaryText =
        'You used alternative signals assertively, but governance or inclusive-purpose play lagged—especially under speed pressure.';
    } else if (ready.score < 3 && overallScore >= 3) {
      summaryText =
        'You see value in alternative indicators, yet desk process (tokens, integration) looked constrained—mirroring the adoption gap this DBA investigates.';
    } else if (overallScore < 3) {
      summaryText =
        'Your desk play was cautious toward alternative signals—or approved without gathering evidence. Traditional thin-file caution still dominates.';
    }
    summaryText += ` Strongest domain: ${strongest.label}. Area to watch: ${weakest.label}.`;

    const assessment = {
      domains: domainResults,
      overall: {
        score: overallScore,
        max: 5,
        percent: Math.round((overallScore / 5) * 100),
        level: overallLevel.id,
        levelLabel: overallLevel.label,
        summary: summaryText,
        strongestDomain: strongest.id,
        weakestDomain: weakest.id,
      },
      telemetry: {
        tokensStart: START_TOKENS,
        tokensEnd: tokensLeft,
        tokensSpent,
        riskStart: START_RISK,
        riskEnd: plays.length ? plays[plays.length - 1].riskAfter : START_RISK,
        multiSignalCases,
        zeroSignalApprovals,
        domainsUsed: { psych: usedPsych, social: usedSocial, behavior: usedBehav },
        preferSignalHitRate: preferTotal ? Number((preferHits / preferTotal).toFixed(2)) : null,
        metersEnd: lastMeters || null,
        softTimeouts: plays.filter((p) => p.timedOut).length,
      },
    };

    assessment.playStyle = derivePlayStyle(plays, assessment);
    return assessment;
  }

  function buildRecord(comment) {
    const assessment = scoreFromPlays(state.plays);
    return {
      id: `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      instrument: INSTRUMENT,
      instrumentType: 'behavioral-game-assessment',
      disclaimer:
        'Research-oriented behavioral instrument / proposal demo. Not a clinical diagnosis, credit score, or institutional decision.',
      savedAt: new Date().toISOString(),
      sessionStartedAt: state.startedAt,
      profile,
      gameplay: {
        cases: state.plays,
        comment: comment || undefined,
        metersStart: { ...METER_START },
      },
      assessment,
    };
  }

  function saveRecord(record) {
    latestRecord = record;
    try {
      localStorage.setItem(LATEST_KEY, JSON.stringify(record));
      const archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
      const list = Array.isArray(archive) ? archive : [];
      list.push(record);
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(-50)));
    } catch {
      /* private mode / quota */
    }
  }

  function setArchiveStatus(state, message) {
    if (!archiveStatusEl) return;
    archiveStatusEl.hidden = false;
    archiveStatusEl.dataset.state = state;
    archiveStatusEl.textContent = message;
  }

  function buildArchivePayload(record) {
    return {
      instrument_id: record.instrument || INSTRUMENT,
      client_record_id: record.id || null,
      profile: record.profile || {},
      responses: {
        gameplay: record.gameplay || {},
        instrumentType: record.instrumentType,
        sessionStartedAt: record.sessionStartedAt,
        savedAt: record.savedAt,
        disclaimer: record.disclaimer,
      },
      assessment: record.assessment || {},
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      page_url: typeof location !== 'undefined' ? location.href : null,
    };
  }

  /**
   * POST assessment to Supabase REST. Never throws to the UI caller —
   * localStorage + download remain the backup if this fails.
   * Anon key is public by design; RLS must allow INSERT only (no SELECT).
   */
  async function submitToResearchArchive(record) {
    if (!archiveConfigured) {
      setArchiveStatus('local', 'Saved locally only (offline / not configured)');
      return { ok: false, reason: 'not-configured' };
    }

    setArchiveStatus('pending', 'Saving to research archive…');

    try {
      const endpoint = `${SUPABASE_URL}/rest/v1/assessment_responses`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(buildArchivePayload(record)),
      });

      if (!res.ok) {
        setArchiveStatus('local', 'Saved locally only (offline / not configured)');
        return { ok: false, reason: 'http', status: res.status };
      }

      setArchiveStatus('archived', 'Saved to research archive');
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
      const r = (score / 5) * radius;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };

    let grid = '';
    [1, 2, 3, 4, 5].forEach((level) => {
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
      const [x, y] = pointAt(i, 5);
      axes += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" />`;
      const [lx, ly] = pointAt(i, 5.85);
      const meta = domainsMeta.find((m) => m.id === d.id);
      labelsSvg += `<text class="radar-label" x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${meta?.short || d.label}</text>`;
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
      dots += `<circle class="radar-point" cx="${x}" cy="${y}" r="4"><title>${d.label}: ${d.score.toFixed(2)} / 5</title></circle>`;
    });

    radarChartEl.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Radar of five domain scores from 1 to 5">
      ${grid}${axes}
      <polygon class="radar-area" points="${areaPts}" />
      ${dots}${labelsSvg}
    </svg>`;
  }

  function renderRecordSummary(record) {
    summary.innerHTML = '';
    const tel = record.assessment?.telemetry || {};
    const rows = [
      { title: 'Role', value: labels.role[record.profile.role] || record.profile.role },
      {
        title: 'Institution type',
        value: labels.institutionType[record.profile.institutionType] || record.profile.institutionType,
      },
      { title: 'Region', value: labels.region[record.profile.region] || record.profile.region },
      {
        title: 'Experience',
        value: labels.yearsExperience[record.profile.yearsExperience] || record.profile.yearsExperience,
      },
      {
        title: 'Familiarity',
        value: labels.familiarity[record.profile.familiarity] || record.profile.familiarity,
      },
    ];

    if (record.assessment?.playStyle) {
      rows.push({ title: 'Play style', value: record.assessment.playStyle.title });
    }

    if (tel.tokensStart != null) {
      rows.push({ title: 'Tokens spent', value: `${tel.tokensSpent} / ${tel.tokensStart}` });
      rows.push({ title: 'Risk budget left', value: String(tel.riskEnd) });
    }
    if (tel.metersEnd) {
      rows.push({
        title: 'Final meters',
        value: `Risk ${Math.round(tel.metersEnd.portfolioRisk)} · Incl ${Math.round(tel.metersEnd.inclusion)} · Gov ${Math.round(tel.metersEnd.governance)}`,
      });
    }
    if (tel.softTimeouts != null) {
      rows.push({ title: 'Soft timeouts', value: String(tel.softTimeouts) });
    }

    (record.gameplay?.cases || []).forEach((play, i) => {
      const signals = play.unlocked?.length ? play.unlocked.join(', ') : 'none';
      const to = play.timedOut ? ' · soft timeout' : '';
      rows.push({
        title: `Case ${i + 1} · ${play.caseName}`,
        value: `${labels.decision[play.decision] || play.decision} · signals: ${signals}${to}`,
      });
    });

    if (record.gameplay?.comment) {
      rows.push({ title: 'Reflection', value: record.gameplay.comment });
    }

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
    if (!assessment.playStyle && record.gameplay?.cases) {
      assessment.playStyle = derivePlayStyle(record.gameplay.cases, assessment);
    }
    overallSummary.textContent = assessment.overall.summary;
    overallScoreEl.textContent = `${assessment.overall.score.toFixed(2)} / 5`;
    overallLevelEl.textContent = assessment.overall.levelLabel;

    if (assessment.playStyle) {
      if (playStyleTitle) playStyleTitle.textContent = assessment.playStyle.title;
      if (playStyleBlurb) playStyleBlurb.textContent = assessment.playStyle.blurb;
      if (playBadgeMark) playBadgeMark.textContent = assessment.playStyle.mark || 'LD';
    }

    renderRadar(assessment.domains);
    domainScoresEl.innerHTML = '';

    assessment.domains.forEach((domain) => {
      const article = document.createElement('article');
      article.className = 'domain-score';
      article.setAttribute('role', 'listitem');
      article.innerHTML = `
        <div class="domain-score-head">
          <strong>${domain.label}</strong>
          <span>${domain.score.toFixed(2)} / 5</span>
        </div>
        <div class="domain-bar" aria-hidden="true"><i style="width:0%"></i></div>
        <span class="domain-level">${domain.levelLabel}</span>
        <p>${domain.interpretation}</p>
      `;
      domainScoresEl.append(article);
      requestAnimationFrame(() => {
        const bar = article.querySelector('.domain-bar > i');
        if (bar) bar.style.width = `${domain.percent}%`;
      });
    });

    renderRecordSummary(record);
  }

  function showResults(record, { submitArchive = false } = {}) {
    flow.hidden = true;
    if (footnote) footnote.hidden = true;
    results.hidden = false;
    renderAssessment(record);
    updateProgress('results');
    if (submitArchive) {
      // Fire-and-forget; results UI must not wait on network
      void submitToResearchArchive(record);
    } else if (archiveStatusEl) {
      archiveStatusEl.hidden = true;
      archiveStatusEl.textContent = '';
      delete archiveStatusEl.dataset.state;
    }
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function restoreLatest() {
    try {
      const saved = localStorage.getItem(LATEST_KEY);
      if (!saved) return;
      const record = JSON.parse(saved);
      if (record?.instrumentType === 'behavioral-game-assessment' && record?.assessment?.domains) {
        latestRecord = record;
        showResults(record, { submitArchive: false });
      }
    } catch {
      /* ignore */
    }
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

  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateProfile()) {
      profileForm.querySelector('.field.invalid select, .field.invalid input')?.focus();
      return;
    }
    profile = collectProfile();
    showPhase('briefing');
  });

  document.getElementById('briefing-back').addEventListener('click', () => {
    showPhase('profile');
  });

  document.getElementById('briefing-start').addEventListener('click', () => {
    resetGameState();
    showPhase('play');
    renderCase();
  });

  document.getElementById('signal-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-signal]');
    if (!btn || btn.disabled) return;
    unlockSignal(btn.dataset.signal);
  });

  document.querySelector('.decision-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-decision]');
    if (!btn || btn.disabled) return;
    decide(btn.dataset.decision);
  });

  // Keyboard: 1/2/3 unlock signals; A/H/D decisions (when focus is in the desk)
  phasePlay.addEventListener('keydown', (e) => {
    if (phasePlay.hidden || deciding) return;
    const tag = e.target?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === '1') {
      e.preventDefault();
      unlockSignal('psych');
    } else if (key === '2') {
      e.preventDefault();
      unlockSignal('social');
    } else if (key === '3') {
      e.preventDefault();
      unlockSignal('behavior');
    } else if (key === 'a') {
      e.preventDefault();
      decide('approve');
    } else if (key === 'h') {
      e.preventDefault();
      decide('hold');
    } else if (key === 'd') {
      e.preventDefault();
      decide('decline');
    }
  });

  document.getElementById('debrief-finish').addEventListener('click', () => {
    const comment = String(document.getElementById('survey-comment').value || '').trim();
    const record = buildRecord(comment);
    saveRecord(record);
    showResults(record, { submitArchive: true });
  });

  if (sfxToggle) {
    sfxToggle.addEventListener('click', () => {
      sfxEnabled = !sfxEnabled;
      if (sfxEnabled) ensureAudio();
      updateSfxToggleUi();
      if (sfxEnabled) playSfx('token');
    });
    updateSfxToggleUi();
  }

  downloadBtn.addEventListener('click', downloadRecord);

  resetBtn.addEventListener('click', () => {
    try {
      localStorage.removeItem(LATEST_KEY);
    } catch {
      /* ignore */
    }
    latestRecord = null;
    state = null;
    profile = {};
    clearTimer();
    profileForm.reset();
    document.getElementById('survey-comment').value = '';
    if (archiveStatusEl) {
      archiveStatusEl.hidden = true;
      archiveStatusEl.textContent = '';
      delete archiveStatusEl.dataset.state;
    }
    results.hidden = true;
    flow.hidden = false;
    if (footnote) footnote.hidden = false;
    clearErrors(profileForm);
    showPhase('profile');
    flow.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });

  showPhase('profile');
  restoreLatest();
})();
