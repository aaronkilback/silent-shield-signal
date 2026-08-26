-- Evidence-bound precision-feed declarations (operator amendment 2026-08-14): a precision
-- exemption is NOT a bare boolean. A declaration counts as EXEMPT only if is_precision_feed
-- AND expected_yield present AND basis present AND review_by >= today. Missing field or past
-- review_by → treated as unverified_exemption (not exempt) by the silent-zero probe.
-- Data, not code (like the anon-surface allowlist): an exemption is a reviewed INSERT.
-- Consumer: silent-zero probe (Variant B; surfaced in Variant A's audit for completeness).
create table if not exists public.monitor_precision_declaration (
  monitor          text primary key,
  is_precision_feed boolean not null default true,
  expected_yield   text,          -- a RATE, e.g. '0-5/month, gated on KEV cadence x client stack'
  basis            text,          -- empirical artifact establishing the expectation
  review_by        date,          -- on expiry the exemption lapses and the probe fires
  created_at       timestamptz not null default now(),
  created_by       text
);

alter table public.monitor_precision_declaration enable row level security;

comment on table public.monitor_precision_declaration is
  'Evidence-bound precision-feed exemptions for the silent-zero probe. Valid exemption = is_precision_feed AND expected_yield AND basis AND review_by>=today. Service-role/operator reads; RLS on, no policy.';

-- darkweb: the standard-setting declaration (its 2026-08-14 verification is the required artifact).
insert into public.monitor_precision_declaration (monitor, is_precision_feed, expected_yield, basis, review_by, created_by)
select 'monitor-darkweb', true,
       '~0 for clients without a cataloged breach; bursty on a new breach. 0/498 runs is correct.',
       'verified 2026-08-14: HIBP_API_KEY set; breaches?domain= returns 200+[] for petronas.ca/bcplace.com/coastalgaslink.com and the real Adobe breach for adobe.com — endpoint discriminates, corporate domains genuinely unbreached',
       date '2026-11-14', 'WO-SILENT-ZERO-PROBE'
where not exists (select 1 from public.monitor_precision_declaration where monitor='monitor-darkweb');
