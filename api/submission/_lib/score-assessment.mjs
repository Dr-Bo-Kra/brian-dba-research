/**
 * Canonical Inclusive Lending Desk scoring.
 * Mirrors script.js scoreAssessment / levelFor / interpretDomain / derivePlayStyle
 * exactly (stable DOMAIN_ORDER tie-break, same strings and thresholds).
 * Used as the sole authority for stored assessment derived fields.
 */
import {
  DEFAULTS,
  DOMAIN_ITEMS,
  DOMAIN_LABELS,
  DOMAIN_ORDER,
} from './constants.mjs';

function mean(values) {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function levelFor(score) {
  if (score >= 5.5) return { id: 'inclusion-forward', label: 'Inclusion-forward' };
  if (score >= 4) return { id: 'balanced', label: 'Balanced' };
  return { id: 'cautious', label: 'Cautious' };
}

export function interpretDomain(id, score) {
  const label = DOMAIN_LABELS[id].toLowerCase();
  if (score >= 5.5) {
    return `Strong alignment with ${label} as informative beyond traditional records for responsible inclusive lending.`;
  }
  if (score >= 4) {
    return `A balanced view of ${label}—useful in places, with room to integrate more systematically.`;
  }
  return `Responses leaned cautious on ${label}—these signals carried limited weight in your desk orientation.`;
}

/**
 * Stable sort keeps DOMAIN_ORDER among equal scores (survey tie-break).
 */
export function pickStrongestDomain(domains) {
  return [...domains].sort((a, b) => b.score - a.score)[0];
}

export function pickWeakestDomain(domains) {
  return [...domains].sort((a, b) => a.score - b.score)[0];
}

export function buildOverallSummary(overallScore, strongest, weakest) {
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
  return summaryText;
}

/**
 * Exact branch order and strings from script.js derivePlayStyle.
 * Note: the social secondary branch uses second.id === 'psychometric' (survey).
 */
export function derivePlayStyle(domains, overall) {
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

/**
 * Full assessment object from validated Likert answers (1–7 integers).
 */
export function scoreAssessment(likert) {
  const domains = DOMAIN_ORDER.map((id) => {
    const items = DOMAIN_ITEMS[id];
    const values = items.map((itemId) => Number(likert[itemId]));
    const score = Number(mean(values).toFixed(2));
    const level = levelFor(score);
    return {
      id,
      label: DOMAIN_LABELS[id],
      score,
      max: DEFAULTS.likertMax,
      percent: Math.round((score / DEFAULTS.likertMax) * 100),
      level: level.id,
      levelLabel: level.label,
      interpretation: interpretDomain(id, score),
      itemIds: [...items],
    };
  });

  const overallScore = Number(mean(domains.map((d) => d.score)).toFixed(2));
  const overallLevel = levelFor(overallScore);
  const strongest = pickStrongestDomain(domains);
  const weakest = pickWeakestDomain(domains);

  return {
    domains,
    overall: {
      score: overallScore,
      max: DEFAULTS.likertMax,
      percent: Math.round((overallScore / DEFAULTS.likertMax) * 100),
      level: overallLevel.id,
      levelLabel: overallLevel.label,
      summary: buildOverallSummary(overallScore, strongest, weakest),
      strongestDomain: strongest.id,
      weakestDomain: weakest.id,
    },
    playStyle: derivePlayStyle(domains, overallScore),
  };
}

/** Score/percent slice used by older callers; prefer scoreAssessment. */
export function recomputeScores(likert) {
  const full = scoreAssessment(likert);
  return {
    domains: full.domains.map((d) => ({
      id: d.id,
      label: d.label,
      score: d.score,
      max: d.max,
      percent: d.percent,
      itemIds: d.itemIds,
    })),
    overall: {
      score: full.overall.score,
      max: full.overall.max,
      percent: full.overall.percent,
    },
  };
}
