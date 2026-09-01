/**
 * Parameterised SQL the researcher API must use. Values are bound, never
 * concatenated. This module does not open a database connection and must not
 * be copied into browser files.
 */
export const SQL = Object.freeze({
  lookupResearcher: {
    text: `select auth_subject, role, mfa_required, revoked_at, disabled_at
           from public.authorised_researchers
           where auth_subject = $1
           limit 1`,
  },
  countActiveResearchers: {
    text: `select count(*)::int as n
           from public.authorised_researchers
           where revoked_at is null
             and disabled_at is null`,
  },
  insertSession: {
    text: `insert into public.researcher_sessions
             (id, auth_subject, mfa_ok, expires_at)
           values ($1, $2, $3, $4::timestamptz)`,
  },
  getSession: {
    text: `select s.id, s.auth_subject, s.mfa_ok, s.expires_at, s.revoked_at,
                  r.role, r.mfa_required, r.revoked_at as researcher_revoked_at,
                  r.disabled_at as researcher_disabled_at
           from public.researcher_sessions s
           join public.authorised_researchers r on r.auth_subject = s.auth_subject
           where s.id = $1
           limit 1`,
  },
  revokeSession: {
    text: `update public.researcher_sessions
           set revoked_at = now()
           where id = $1 and revoked_at is null`,
  },
  revokeSessionsForSubject: {
    text: `update public.researcher_sessions
           set revoked_at = now()
           where auth_subject = $1 and revoked_at is null`,
  },
  cleanupExpiredSessions: {
    text: `delete from public.researcher_sessions
           where expires_at < now()`,
  },
  trend: {
    name: 'trend',
    text: `select created_at::date::text as day, count(*)::int as count
           from public.assessment_responses
           where anonymised_at is null
             and ($1::date is null or created_at::date >= $1)
             and ($2::date is null or created_at::date <= $2)
             and ($3::text is null or profile ->> 'countryRegion' = $3)
             and ($4::text is null or profile ->> 'position' = $4)
             and ($5::text is null or profile ->> 'yearsLending' = $5)
           group by 1
           order by 1`,
  },
  hitRateLimit: {
    text: `insert into public.researcher_rate_limits (bucket_key, window_started_at, hit_count)
           values ($1, now(), 1)
           on conflict (bucket_key) do update
             set window_started_at = case
               when public.researcher_rate_limits.window_started_at <= now() - ($2::int * interval '1 millisecond')
               then now()
               else public.researcher_rate_limits.window_started_at
             end,
                 hit_count = case
               when public.researcher_rate_limits.window_started_at <= now() - ($2::int * interval '1 millisecond')
               then 1
               else public.researcher_rate_limits.hit_count + 1
             end
           returning hit_count <= $3 as allowed`,
  },
  summary: {
    name: 'summary',
    text: `select
             count(*)::int as total,
             count(*) filter (where created_at >= now() - interval '24 hours')::int as last_24h,
             avg((assessment -> 'overall' ->> 'score')::numeric) as mean_orientation,
             max(created_at) as last_intake,
             count(*) filter (where legal_hold is true)::int as legal_hold,
             0::int as anonymised
           from public.assessment_responses
           where anonymised_at is null
             and ($1::date is null or created_at::date >= $1)
             and ($2::date is null or created_at::date <= $2)
             and ($3::text is null or profile ->> 'countryRegion' = $3)
             and ($4::text is null or profile ->> 'position' = $4)
             and ($5::text is null or profile ->> 'yearsLending' = $5)`,
  },
  listResponses: {
    text: `select client_record_id, created_at,
                  profile ->> 'countryRegion' as region,
                  profile ->> 'position' as role,
                  profile ->> 'yearsLending' as experience,
                  (assessment -> 'overall' ->> 'score')::numeric as orientation,
                  legal_hold, anonymised_at
           from public.assessment_responses
           where anonymised_at is null
             and ($1::date is null or created_at::date >= $1)
             and ($2::date is null or created_at::date <= $2)
             and ($3::text is null or profile ->> 'countryRegion' = $3)
             and ($4::text is null or profile ->> 'position' = $4)
             and ($5::text is null or profile ->> 'yearsLending' = $5)
             and ($6::text is null or client_record_id ilike $6)
           order by created_at desc
           limit $7`,
  },
  getByReference: {
    text: `select client_record_id, created_at,
                  profile ->> 'countryRegion' as region,
                  profile ->> 'position' as role,
                  profile ->> 'yearsLending' as experience,
                  (assessment -> 'overall' ->> 'score')::numeric as orientation,
                  legal_hold, anonymised_at
           from public.assessment_responses
           where client_record_id = $1 and anonymised_at is null
           limit 1`,
  },
  getQualitativeByReference: {
    text: `select client_record_id,
                  responses -> 'qualitative' as qualitative
           from public.assessment_responses
           where client_record_id = $1 and anonymised_at is null
           limit 1`,
  },
  exportRows: {
    text: `select client_record_id as participant_reference,
                  created_at as accepted_at,
                  profile ->> 'countryRegion' as region,
                  profile ->> 'position' as role,
                  profile ->> 'yearsLending' as experience,
                  (assessment -> 'overall' ->> 'score')::numeric as orientation
           from public.assessment_responses
           where anonymised_at is null
             and ($1::date is null or created_at::date >= $1)
             and ($2::date is null or created_at::date <= $2)
             and ($3::text is null or profile ->> 'countryRegion' = $3)
             and ($4::text is null or profile ->> 'position' = $4)
             and ($5::text is null or profile ->> 'yearsLending' = $5)
             and ($6::text is null or client_record_id ilike $6)
           order by created_at desc
           limit $7`,
  },
  deleteByReference: {
    text: `delete from public.assessment_responses
           where client_record_id = $1
             and legal_hold is not true
             and anonymised_at is null`,
  },
  insertAudit: {
    name: 'insertAudit',
    text: `insert into public.researcher_audit_events
             (actor_id, action, participant_reference, detail, actor_role)
           values ($1, $2, $3, $4::jsonb, $5)`,
  },
  putAuthState: {
    name: 'putAuthState',
    text: `insert into public.researcher_auth_states
             (state, nonce, code_verifier, transaction_id, expires_at)
           values ($1, $2, $3, $4, $5::timestamptz)`,
  },
  peekAuthState: {
    name: 'peekAuthState',
    text: `select state, nonce, code_verifier, transaction_id, expires_at
           from public.researcher_auth_states
           where state = $1
             and consumed_at is null
             and expires_at > now()
           limit 1`,
  },
  consumeAuthState: {
    name: 'consumeAuthState',
    text: `update public.researcher_auth_states
              set consumed_at = now()
            where state = $1
              and consumed_at is null
              and expires_at > now()
            returning state, nonce, code_verifier, transaction_id, expires_at`,
  },
  domainAggregates: {
    name: 'domainAggregates',
    text: `select d.id as id,
                  avg(d.score)::float8 as score,
                  count(*)::int as n
           from public.assessment_responses r
           cross join lateral jsonb_to_recordset(coalesce(r.assessment -> 'domains', '[]'::jsonb))
             as d(id text, label text, score numeric)
           where r.anonymised_at is null
             and d.id in ('psychometric', 'social', 'behavioral', 'readiness', 'inclusiveDecision')
             and d.score is not null
             and ($1::date is null or r.created_at::date >= $1)
             and ($2::date is null or r.created_at::date <= $2)
             and ($3::text is null or r.profile ->> 'countryRegion' = $3)
             and ($4::text is null or r.profile ->> 'position' = $4)
             and ($5::text is null or r.profile ->> 'yearsLending' = $5)
           group by d.id`,
  },
  itemAggregates: {
    name: 'itemAggregates',
    text: `select e.key as id,
                  count(*) filter (where e.value = '1')::int as c1,
                  count(*) filter (where e.value = '2')::int as c2,
                  count(*) filter (where e.value = '3')::int as c3,
                  count(*) filter (where e.value = '4')::int as c4,
                  count(*) filter (where e.value = '5')::int as c5,
                  count(*) filter (where e.value = '6')::int as c6,
                  count(*) filter (where e.value = '7')::int as c7
           from public.assessment_responses r
           cross join lateral jsonb_each_text(coalesce(r.responses -> 'quantitative' -> 'likert', '{}'::jsonb)) e
           where r.anonymised_at is null
             and e.key in (
               'B1','B2','B3','B4','B5','C6','C7','C8','C9','C10',
               'D11','D12','D13','D14','D15','E16','E17','E18','E19','E20',
               'F21','F22','F23','F24','F25'
             )
             and e.value in ('1','2','3','4','5','6','7')
             and ($1::date is null or r.created_at::date >= $1)
             and ($2::date is null or r.created_at::date <= $2)
             and ($3::text is null or r.profile ->> 'countryRegion' = $3)
             and ($4::text is null or r.profile ->> 'position' = $4)
             and ($5::text is null or r.profile ->> 'yearsLending' = $5)
           group by e.key`,
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
