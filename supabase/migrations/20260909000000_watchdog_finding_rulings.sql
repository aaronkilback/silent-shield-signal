-- WO-WATCHDOG-FINDING-TRIAGE — durable fix for two-producer drift in platform_findings.
--
-- Problem (triage 2026-09-09): findings were produced by two systems that never agreed —
-- deterministic probes (panel, ruling-aware only via hardcoded substring reclassification) and
-- the AI email path (re-judged severity every run, ruling-blind). No first-class "ruling" existed,
-- so a decision the operator made lived only as hardcoded text inside one probe branch. That caused
-- (a) the same condition surfacing at two severities on two surfaces, (b) a title-keyed fingerprint
-- that minted a duplicate whenever the title was re-worded, and (c) the email silently dropping the
-- least-severe findings behind a bare "N of M" count.
--
-- This migration adds the durable substrate:
--   1. condition_key on platform_findings (stable identity, NOT the free-text title)
--   2. a first-class finding_rulings table (accepted = suppress-with-ruling; disregarded = false check)
--   3. record_platform_finding keyed on condition_key + applying the ruling at write time
--   4. seeds the 2026-09-09 operator rulings and re-keys the current open rows
--
-- Both surfaces read platform_findings (panel already does; the watchdog email is refactored to in
-- the same PR). Suppression alone was rejected by ruling: it would have to be written per-surface and
-- would drift again.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columns on platform_findings. condition_key is the stable identity; the ruling fields are
--    DENORMALIZED from finding_rulings at write time so the panel (which reads this table) renders
--    the ruling without a second query.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.platform_findings add column if not exists condition_key text;
alter table public.platform_findings add column if not exists ruling_state  text
  check (ruling_state in ('accepted','disregarded'));
alter table public.platform_findings add column if not exists ruling_note   text;

create index if not exists idx_platform_findings_condition_key on public.platform_findings(condition_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. finding_rulings — the operator's decisions, keyed by CONDITION (survives finding-row churn).
--    accepted    = true and already decided → suppress from daily alarm, carry the ruling so a future
--                  reader knows WHY it is quiet; pinned to ruling_severity (default 'low').
--    disregarded = the check itself was wrong → the producer must not surface it at all.
--    escalate_when_metric_gt = for accepted findings that should re-alarm past a threshold (e.g. the
--                  incident-evidence ruling: quiet at n<=5, alarm again above).
--    RLS-at-Creation: enabled, no policy → service-role/SECURITY-DEFINER writers only, closed to anon.
--
-- Why no policy (rationale for the check4 exemption below):
--   finding_rulings is service-role-only — written and read exclusively via record_platform_finding
--   under service role; the panel reads the DENORMALIZED ruling_state/ruling_note on platform_findings,
--   never this table directly. RLS-on + no policy is the correct CLOSED state per RLS-at-Creation; a
--   policy would only WIDEN access.
-- INVALIDATION CONDITION (an exemption without its expiry becomes permanent cover): this holds ONLY
--   while finding_rulings has no non-service-role reader. If any surface ever queries it directly under
--   authenticated or anon, the exemption is VOID and a policy is required.
-- @security-exempt(check4): finding_rulings service-role-only, deny-by-default, no non-service-role reader; void if ever read under authenticated/anon then a policy is required — 2026-09-09
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.finding_rulings (
  condition_key           text primary key,
  ruling_state            text not null check (ruling_state in ('accepted','disregarded')),
  ruling_note             text not null,
  ruling_severity         text,               -- pinned severity for 'accepted' (null → 'low')
  escalate_when_metric_gt numeric,            -- null → never escalate; else alarm when metric_value >
  ruled_by                text,
  ruled_at                timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.finding_rulings enable row level security;
comment on table public.finding_rulings is
  'WO-WATCHDOG-FINDING-TRIAGE: operator rulings on watchdog findings, keyed by condition_key. '
  'accepted = suppress-with-ruling (carries the why); disregarded = false check, never surfaced. '
  'Read at write time by record_platform_finding and denormalized onto platform_findings.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. record_platform_finding — now keyed on condition_key (title-independent) and ruling-aware.
--    p_condition_key : stable identity supplied by the probe. Falls back to the legacy
--                      (category|normalized-title|job) formula ONLY when a caller omits it, so any
--                      un-keyed caller keeps its old dedup behavior (no regression).
--    p_metric_value  : optional numeric the ruling's escalate_when_metric_gt is compared against.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_platform_finding(
  p_category text, p_severity text, p_title text, p_analysis text,
  p_plain_english text, p_action text, p_affected_agent text, p_affected_job text,
  p_condition_key text default null, p_metric_value numeric default null
) returns void language plpgsql as $$
declare
  v_ck   text;
  v_fp   text;
  v_sev  text := coalesce(p_severity, 'info');
  v_rst  text := null;
  v_rnt  text := null;
  r      record;
begin
  -- Condition key: explicit if supplied; else legacy title-based identity (backward compatible).
  if nullif(p_condition_key, '') is not null then
    v_ck := p_condition_key;
  else
    v_ck := coalesce(p_category,'unknown') || '|' ||
            regexp_replace(left(coalesce(p_title,''),100), '[0-9]+', '#', 'g') || '|' ||
            coalesce(p_affected_job,'');
  end if;
  v_fp := encode(digest('ck:' || v_ck, 'sha256'), 'hex');

  -- Ruling application (condition-keyed, authoritative).
  select * into r from public.finding_rulings where condition_key = v_ck;
  if found then
    if r.ruling_state = 'disregarded' then
      return;  -- false check: never surface this condition
    elsif r.ruling_state = 'accepted' then
      -- suppress-with-ruling UNLESS an escalation threshold is crossed
      if r.escalate_when_metric_gt is null
         or p_metric_value is null
         or p_metric_value <= r.escalate_when_metric_gt then
        v_sev := coalesce(r.ruling_severity, 'low');
        v_rst := 'accepted';
        v_rnt := r.ruling_note;
      end if;
    end if;
  end if;

  insert into public.platform_findings
    (fingerprint, condition_key, category, severity, title, analysis, plain_english, action,
     affected_agent, affected_job, ruling_state, ruling_note, metadata,
     first_seen_at, last_seen_at, occurrence_count, resolved_at)
  values
    (v_fp, v_ck, coalesce(p_category,'unknown'), v_sev, p_title, p_analysis,
     p_plain_english, p_action, p_affected_agent, p_affected_job, v_rst, v_rnt,
     jsonb_build_object('source','system-watchdog','metric_value',p_metric_value), now(), now(), 1, null)
  on conflict (fingerprint) do update set
    last_seen_at     = now(),
    occurrence_count = public.platform_findings.occurrence_count + 1,
    condition_key    = excluded.condition_key,
    severity         = excluded.severity,
    title            = excluded.title,
    analysis         = excluded.analysis,
    plain_english    = excluded.plain_english,
    action           = excluded.action,
    affected_agent   = excluded.affected_agent,
    affected_job     = excluded.affected_job,
    ruling_state     = excluded.ruling_state,
    ruling_note      = excluded.ruling_note,
    resolved_at      = null;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed the 2026-09-09 operator rulings.
--    accepted (suppress-with-ruling): belief-frozen, instagram-deferred, fleet-dormant,
--    provenance-coverage, incident-noncitable-evidence (with re-alarm above n=5).
--    #8 registry-phantoms and #9 auto_approve are handled in CODE (severity fix / predicate repair),
--    not by a ruling row — see the WO doc.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.finding_rulings
  (condition_key, ruling_state, ruling_note, ruling_severity, escalate_when_metric_gt, ruled_by) values
  ('agent-learning:belief-writes-frozen', 'accepted',
   'INC-LEARN-CONTAM write-freeze (intentional containment). Unfreeze gated on WO-BELIEF-PROVENANCE-01 anonymization work.',
   'low', null, 'operator:ak 2026-09-09'),
  ('behavioral:social-zero-signals:monitor-instagram-2h', 'accepted',
   'Instagram keyword-CSE deferral (social audit 2026-07-15). Returns nothing by design; successor is actor-list collection.',
   'low', null, 'operator:ak 2026-09-09'),
  ('behavioral:fleet-dormant', 'accepted',
   'Honest capability ledger — fleet configured beyond what current routing engages. Strategic roadmap decision, not a defect.',
   'low', null, 'operator:ak 2026-09-09'),
  ('behavioral:provenance-coverage', 'accepted',
   'Tracked under INC-XTEN (OPEN). True gap; safe state is non-citable, which is the current behavior. Does not need daily reporting.',
   'low', null, 'operator:ak 2026-09-09'),
  ('behavioral:incident-noncitable-evidence', 'accepted',
   'n<=5 kept out of client reports, safe by design. Re-alarm if the count exceeds 5.',
   'low', 5, 'operator:ak 2026-09-09')
on conflict (condition_key) do update set
  ruling_state = excluded.ruling_state, ruling_note = excluded.ruling_note,
  ruling_severity = excluded.ruling_severity, escalate_when_metric_gt = excluded.escalate_when_metric_gt,
  ruled_by = excluded.ruled_by, updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Re-key the CURRENT open rows to condition keys + apply rulings immediately, so the panel is
--    correct the moment this deploys (rather than waiting for the next watchdog run to re-emit).
--    Fingerprint recomputed to the new 'ck:'||condition_key formula to match the RPC.
--    NOTE: forward-only; only the known open rows are mapped. Anything unmatched keeps its old
--    fingerprint and is re-keyed naturally on the next watchdog run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 5a. Collapse the instagram DUPLICATE: the HIGH "structurally broken" row (pre-ruling framing,
--     second fingerprint) is the same condition as the LOW "deferred by ruling" row. Resolve it;
--     the deferred row (5c) is the surviving, ruling-aware record.
update public.platform_findings
set resolved_at = now(),
    resolution_note = 'WO-WATCHDOG-FINDING-TRIAGE: duplicate of the deferred-by-ruling finding for the same job (title-keyed fingerprint minted a second row); superseded by condition-keyed record.'
where resolved_at is null
  and affected_job like 'monitor-instagram%'
  and title ilike '%NEVER produced a signal%structurally broken%';

-- helper: recompute fingerprint + apply an accepted ruling to a matched open row
-- (inlined per row below rather than a function, to keep the migration self-contained).

-- 5b. belief writes frozen → accepted/low
update public.platform_findings f set
  condition_key = 'agent-learning:belief-writes-frozen',
  fingerprint   = encode(digest('ck:agent-learning:belief-writes-frozen','sha256'),'hex'),
  severity = 'low', ruling_state = 'accepted',
  ruling_note = (select ruling_note from public.finding_rulings where condition_key='agent-learning:belief-writes-frozen')
where f.resolved_at is null and f.title ilike '%belief writes frozen%';

-- 5c. instagram deferred → accepted/low
update public.platform_findings f set
  condition_key = 'behavioral:social-zero-signals:monitor-instagram-2h',
  fingerprint   = encode(digest('ck:behavioral:social-zero-signals:monitor-instagram-2h','sha256'),'hex'),
  severity = 'low', ruling_state = 'accepted',
  ruling_note = (select ruling_note from public.finding_rulings where condition_key='behavioral:social-zero-signals:monitor-instagram-2h')
where f.resolved_at is null and f.affected_job like 'monitor-instagram%'
  and f.title ilike '%deferred by ruling%';

-- 5d. fleet dormant → accepted/low
update public.platform_findings f set
  condition_key = 'behavioral:fleet-dormant',
  fingerprint   = encode(digest('ck:behavioral:fleet-dormant','sha256'),'hex'),
  severity = 'low', ruling_state = 'accepted',
  ruling_note = (select ruling_note from public.finding_rulings where condition_key='behavioral:fleet-dormant')
where f.resolved_at is null and f.title ilike '%fleet largely dormant%';

-- 5e. provenance coverage → accepted/low
update public.platform_findings f set
  condition_key = 'behavioral:provenance-coverage',
  fingerprint   = encode(digest('ck:behavioral:provenance-coverage','sha256'),'hex'),
  severity = 'low', ruling_state = 'accepted',
  ruling_note = (select ruling_note from public.finding_rulings where condition_key='behavioral:provenance-coverage')
where f.resolved_at is null and f.title ilike '%Provenance coverage%';

-- 5f. incident non-citable evidence → accepted/low (n=1 today, below the escalate>5 threshold)
update public.platform_findings f set
  condition_key = 'behavioral:incident-noncitable-evidence',
  fingerprint   = encode(digest('ck:behavioral:incident-noncitable-evidence','sha256'),'hex'),
  severity = 'low', ruling_state = 'accepted',
  ruling_note = (select ruling_note from public.finding_rulings where condition_key='behavioral:incident-noncitable-evidence')
where f.resolved_at is null and f.title ilike '%Incident evidence%non-citable%';

-- 5g. registry phantoms → FIX the severity (Registry-is-a-Promise = critical). No ruling; the
--     mis-severity was the containment-substring reclassification wrongly downgrading the aggregate
--     finding because one listed job matched a contained alias. Condition-keyed findings bypass that
--     reclassification in code; here we correct the persisted row directly.
update public.platform_findings f set
  condition_key = 'behavioral:registry-phantoms',
  fingerprint   = encode(digest('ck:behavioral:registry-phantoms','sha256'),'hex'),
  severity = 'critical', ruling_state = null, ruling_note = null
where f.resolved_at is null and f.title ilike '%Registry phantoms%';

-- 5h. news-google heartbeat counter drift → FIX item (real instrumentation bug); re-key only, no ruling.
update public.platform_findings f set
  condition_key = 'behavioral:heartbeat-counter-drift:monitor-news-google-hourly',
  fingerprint   = encode(digest('ck:behavioral:heartbeat-counter-drift:monitor-news-google-hourly','sha256'),'hex')
where f.resolved_at is null and f.title ilike '%heartbeat counter drift%';
