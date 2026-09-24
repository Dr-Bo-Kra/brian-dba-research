/**
 * Parameterised SQL for the submission API. Values are bound, never
 * concatenated. This module does not open a connection and must not ship
 * to browser files.
 *
 * Idempotency uses plain INSERT + unique_violation handling so the
 * submission_inserter role does not need a SELECT policy on
 * assessment_responses (ON CONFLICT under FORCE RLS typically would).
 */
export const SQL = Object.freeze({
  insertSubmission: {
    text: `insert into public.assessment_responses (
              instrument_id,
              client_record_id,
              profile,
              responses,
              assessment,
              privacy_notice_version,
              consented_at
            ) values (
              $1,
              $2,
              $3::jsonb,
              $4::jsonb,
              $5::jsonb,
              $6,
              $7::timestamptz
            )`,
  },
  hitRateLimit: {
    text: `insert into public.submission_rate_limits (bucket_key, window_started_at, hit_count)
           values ($1, now(), 1)
           on conflict (bucket_key) do update
             set window_started_at = case
               when public.submission_rate_limits.window_started_at <= now() - ($2::int * interval '1 millisecond')
               then now()
               else public.submission_rate_limits.window_started_at
             end,
                 hit_count = case
               when public.submission_rate_limits.window_started_at <= now() - ($2::int * interval '1 millisecond')
               then 1
               else public.submission_rate_limits.hit_count + 1
             end
           returning hit_count <= $3 as allowed`,
  },
});

export function assertBoundQuery(query) {
  if (!query || typeof query.text !== 'string') {
    throw new Error('invalid_query');
  }
  if (/\b(select|insert|update|delete)\b/i.test(query.text) === false) {
    throw new Error('invalid_query');
  }
  if (query.text.includes('${') || query.text.includes('` +')) {
    throw new Error('unsafe_query');
  }
  return query;
}

export const UNIQUE_VIOLATION = '23505';
