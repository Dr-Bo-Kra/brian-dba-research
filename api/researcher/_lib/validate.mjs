import {
  DEFAULTS,
  EXPERIENCE_CODES,
  GENERIC_ERRORS,
  PARTICIPANT_REF,
  REGION_CODES,
  ROLE_CODES,
  SORT_FIELDS,
} from './constants.mjs';

export function errorBody(code) {
  return { error: GENERIC_ERRORS[code] || GENERIC_ERRORS.unavailable };
}

export function parseIsoDate(value) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export function parseParticipantRef(value) {
  const ref = String(value || '').trim();
  return PARTICIPANT_REF.test(ref) ? ref : null;
}

export function parseLimit(value, max = DEFAULTS.maxPageSize) {
  if (value == null || value === '') return DEFAULTS.defaultPageSize;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export function parseFilters(input = {}) {
  const unknown = Object.keys(input).filter(
    (key) =>
      ![
        'from',
        'to',
        'region',
        'role',
        'experience',
        'q',
        'limit',
        'cursor',
        'sort',
        'include_qualitative',
      ].includes(key)
  );
  if (unknown.length) {
    return { ok: false, error: 'invalid_request' };
  }

  const from = parseIsoDate(input.from);
  if (input.from && !from) return { ok: false, error: 'invalid_request' };
  const to = parseIsoDate(input.to);
  if (input.to && !to) return { ok: false, error: 'invalid_request' };
  if (from && to && from > to) return { ok: false, error: 'invalid_request' };

  if (input.region && !REGION_CODES.includes(input.region)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (input.role && !ROLE_CODES.includes(input.role)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (input.experience && !EXPERIENCE_CODES.includes(input.experience)) {
    return { ok: false, error: 'invalid_request' };
  }

  let q = '';
  if (input.q != null && input.q !== '') {
    const raw = String(input.q).trim();
    if (raw.length > 80) return { ok: false, error: 'invalid_request' };
    q = raw.toLowerCase();
  }

  const limit = parseLimit(input.limit);
  if (limit == null) return { ok: false, error: 'invalid_request' };

  if (input.sort && !SORT_FIELDS.includes(input.sort)) {
    return { ok: false, error: 'invalid_request' };
  }

  if (input.cursor != null && input.cursor !== '') {
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(String(input.cursor))) {
      return { ok: false, error: 'invalid_request' };
    }
  }

  if (
    input.include_qualitative != null &&
    !['1', 'true', '0', 'false', ''].includes(String(input.include_qualitative))
  ) {
    return { ok: false, error: 'invalid_request' };
  }

  return {
    ok: true,
    filters: {
      from: from || null,
      to: to || null,
      region: input.region || null,
      role: input.role || null,
      experience: input.experience || null,
      q,
      limit,
      cursor: input.cursor || null,
      sort: 'created_at',
      includeQualitative: input.include_qualitative === '1' || input.include_qualitative === 'true',
    },
  };
}

export function parseDeletionBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request' };
  }
  const extra = Object.keys(body).filter((key) => !['reference', 'confirm'].includes(key));
  if (extra.length) return { ok: false, error: 'invalid_request' };
  const reference = parseParticipantRef(body.reference);
  if (!reference || body.confirm !== true) return { ok: false, error: 'invalid_request' };
  return { ok: true, reference };
}

export function parseExportBody(body, maxRows) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request' };
  }
  const extra = Object.keys(body).filter(
    (key) => !['from', 'to', 'region', 'role', 'experience', 'q', 'confirm'].includes(key)
  );
  if (extra.length) return { ok: false, error: 'invalid_request' };
  if (body.confirm !== true) return { ok: false, error: 'invalid_request' };
  const parsed = parseFilters({
    from: body.from,
    to: body.to,
    region: body.region,
    role: body.role,
    experience: body.experience,
    q: body.q,
    limit: 1,
  });
  if (!parsed.ok) return parsed;
  return { ok: true, filters: parsed.filters, maxRows };
}
