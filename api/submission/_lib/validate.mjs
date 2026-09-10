/**
 * Strict validation for the canonical buildArchivePayload shape.
 * Live contract is quantitative-only: rejects unknown fields (including
 * smuggled qualitative keys). Recomputes the full assessment from Likert and
 * stores the server-authoritative result (scores + deterministic derived
 * fields). Browser-supplied derived values are ignored after shape checks.
 */
import {
  ALLOWED_DISCLAIMER,
  ASSESSMENT_KEYS,
  DEFAULTS,
  DEMOGRAPHIC_KEYS,
  DOMAIN_ITEMS,
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  DOMAIN_RESULT_KEYS,
  INSTRUMENT_ID,
  INSTRUMENT_TYPE,
  ITEM_ORDER,
  OVERALL_KEYS,
  PARTICIPANT_REF,
  PLAY_STYLE_KEYS,
  PROFILE_KEYS,
  PROFILE_OPTION_CODES,
  QUANTITATIVE_KEYS,
  RESPONSES_KEYS,
  SYNTHETIC_REF_PREFIX,
  TOP_LEVEL_KEYS,
} from './constants.mjs';
import { recomputeScores, scoreAssessment } from './score-assessment.mjs';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(obj, allowed) {
  const keys = Object.keys(obj);
  if (keys.length !== allowed.length) return false;
  return allowed.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function parseIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  if (iso.slice(0, 19) !== value.slice(0, 19)) return null;
  return iso;
}

function codeIn(list, value) {
  return typeof value === 'string' && list.includes(value);
}

function validateString(value, { min = 0, max }) {
  if (typeof value !== 'string') return false;
  if (value.length < min || value.length > max) return false;
  return true;
}

function validateProfile(profile) {
  if (!isPlainObject(profile) || !exactKeys(profile, PROFILE_KEYS)) return false;
  for (const key of PROFILE_KEYS) {
    if (!codeIn(PROFILE_OPTION_CODES[key], profile[key])) return false;
  }
  return true;
}

function validateDemographics(demographics, profile) {
  if (!isPlainObject(demographics) || !exactKeys(demographics, DEMOGRAPHIC_KEYS)) return false;
  for (const key of DEMOGRAPHIC_KEYS) {
    if (demographics[key] !== profile[key]) return false;
  }
  return true;
}

function validateLikert(likert) {
  if (!isPlainObject(likert) || !exactKeys(likert, ITEM_ORDER)) return false;
  for (const id of ITEM_ORDER) {
    const value = likert[id];
    if (!Number.isInteger(value) || value < DEFAULTS.likertMin || value > DEFAULTS.likertMax) {
      return false;
    }
  }
  return true;
}

/**
 * Payload-contract shape only. Scores and deterministic narratives are not
 * trusted from the browser — they are replaced via scoreAssessment(likert).
 */
function validateAssessmentShape(assessment) {
  if (!isPlainObject(assessment) || !exactKeys(assessment, ASSESSMENT_KEYS)) return false;
  if (!Array.isArray(assessment.domains) || assessment.domains.length !== DOMAIN_ORDER.length) {
    return false;
  }
  for (let i = 0; i < DOMAIN_ORDER.length; i += 1) {
    const domain = assessment.domains[i];
    if (!isPlainObject(domain) || !exactKeys(domain, DOMAIN_RESULT_KEYS)) return false;
    if (domain.id !== DOMAIN_ORDER[i]) return false;
    if (domain.label !== DOMAIN_LABELS[domain.id]) return false;
    if (domain.max !== DEFAULTS.likertMax) return false;
    if (
      !Array.isArray(domain.itemIds) ||
      domain.itemIds.length !== DOMAIN_ITEMS[domain.id].length ||
      domain.itemIds.some((id, idx) => id !== DOMAIN_ITEMS[domain.id][idx])
    ) {
      return false;
    }
    // Derived fields must be present as the right types for the wire contract;
    // values are ignored and replaced server-side.
    if (typeof domain.score !== 'number') return false;
    if (typeof domain.percent !== 'number') return false;
    if (typeof domain.level !== 'string' || domain.level.length < 1 || domain.level.length > 40) {
      return false;
    }
    if (
      typeof domain.levelLabel !== 'string' ||
      domain.levelLabel.length < 1 ||
      domain.levelLabel.length > 80
    ) {
      return false;
    }
    if (
      !validateString(domain.interpretation, {
        min: 1,
        max: DEFAULTS.maxInterpretationLen,
      })
    ) {
      return false;
    }
  }

  const overall = assessment.overall;
  if (!isPlainObject(overall) || !exactKeys(overall, OVERALL_KEYS)) return false;
  if (typeof overall.score !== 'number') return false;
  if (overall.max !== DEFAULTS.likertMax) return false;
  if (typeof overall.percent !== 'number') return false;
  if (typeof overall.level !== 'string' || overall.level.length < 1 || overall.level.length > 40) {
    return false;
  }
  if (
    typeof overall.levelLabel !== 'string' ||
    overall.levelLabel.length < 1 ||
    overall.levelLabel.length > 80
  ) {
    return false;
  }
  if (!validateString(overall.summary, { min: 1, max: DEFAULTS.maxSummaryLen })) return false;
  if (!DOMAIN_ORDER.includes(overall.strongestDomain)) return false;
  if (!DOMAIN_ORDER.includes(overall.weakestDomain)) return false;

  const playStyle = assessment.playStyle;
  if (!isPlainObject(playStyle) || !exactKeys(playStyle, PLAY_STYLE_KEYS)) return false;
  if (!validateString(playStyle.id, { min: 1, max: 64 })) return false;
  if (!validateString(playStyle.mark, { min: 1, max: 8 })) return false;
  if (!validateString(playStyle.title, { min: 1, max: 80 })) return false;
  if (!validateString(playStyle.blurb, { min: 1, max: DEFAULTS.maxPlayStyleBlurbLen })) return false;

  return true;
}

export function parseParticipantRef(value) {
  const ref = String(value || '').trim();
  if (!PARTICIPANT_REF.test(ref)) return null;
  if (ref.toLowerCase().startsWith(SYNTHETIC_REF_PREFIX.toLowerCase())) return null;
  return ref;
}

export function validateSubmissionPayload(body) {
  if (!isPlainObject(body) || !exactKeys(body, TOP_LEVEL_KEYS)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (body.instrument_id !== INSTRUMENT_ID) {
    return { ok: false, error: 'invalid_request' };
  }
  const clientRecordId = parseParticipantRef(body.client_record_id);
  if (!clientRecordId) return { ok: false, error: 'invalid_request' };

  if (
    !validateString(body.privacy_notice_version, {
      min: 1,
      max: DEFAULTS.maxPrivacyNoticeLen,
    })
  ) {
    return { ok: false, error: 'invalid_request' };
  }

  const consentedAt = parseIsoTimestamp(body.consented_at);
  if (!consentedAt) return { ok: false, error: 'invalid_request' };
  const consentMs = Date.parse(consentedAt);
  const now = Date.now();
  if (consentMs > now + 5 * 60 * 1000 || consentMs < now - DEFAULTS.consentSkewMs) {
    return { ok: false, error: 'invalid_request' };
  }

  if (!validateProfile(body.profile)) return { ok: false, error: 'invalid_request' };

  const responses = body.responses;
  if (!isPlainObject(responses) || !exactKeys(responses, RESPONSES_KEYS)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (responses.instrumentType !== INSTRUMENT_TYPE) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!parseIsoTimestamp(responses.sessionStartedAt)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!parseIsoTimestamp(responses.savedAt)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (responses.disclaimer !== ALLOWED_DISCLAIMER) {
    return { ok: false, error: 'invalid_request' };
  }

  const quantitative = responses.quantitative;
  if (!isPlainObject(quantitative) || !exactKeys(quantitative, QUANTITATIVE_KEYS)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (quantitative.vignetteAcknowledged !== true) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!parseIsoTimestamp(quantitative.vignetteAcknowledgedAt)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!validateDemographics(quantitative.demographics, body.profile)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!validateLikert(quantitative.likert)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!validateAssessmentShape(body.assessment)) {
    return { ok: false, error: 'invalid_request' };
  }

  const assessment = scoreAssessment(quantitative.likert);

  return {
    ok: true,
    row: {
      instrument_id: INSTRUMENT_ID,
      client_record_id: clientRecordId,
      profile: body.profile,
      responses,
      assessment,
      privacy_notice_version: body.privacy_notice_version,
      consented_at: consentedAt,
    },
  };
}

export { recomputeScores, scoreAssessment };
