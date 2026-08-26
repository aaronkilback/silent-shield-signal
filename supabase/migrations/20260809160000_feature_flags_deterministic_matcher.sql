-- WO-GATE-PHASE3 deterministic cutover kill switch. Read per-invocation by
-- process-intelligence-document → operator can flip without a redeploy.
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security; -- RLS-at-Creation: service-role reads/writes only, no anon

insert into public.feature_flags (key, enabled, description) values
  ('deterministic_matcher_enabled', true,
   'WO-GATE-PHASE3 cutover (2026-08-09): process-intelligence-document matchClientKeywords uses the token-boundary + common-noun-asset-retired matcher when TRUE; legacy .includes() when FALSE. KILL SWITCH — set enabled=false to instantly revert to the legacy matcher without a redeploy.')
on conflict (key) do update set description=excluded.description, updated_at=now();
