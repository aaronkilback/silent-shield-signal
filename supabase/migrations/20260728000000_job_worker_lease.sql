-- INC-JOBWORKER-SATURATION-2026-07-27 — single-flight lease for job-worker.
--
-- Root cause of the incident: pg_cron fires job-worker every 60s, but a run
-- can last up to RUN_TIMEOUT_MS (110s). Runs overlapped, and concurrent
-- workers each held DB connections against slow/failing targets until the
-- connection pool was exhausted (total lockout).
--
-- This singleton row is the cross-invocation mutex. The worker acquires it
-- with one atomic conditional UPDATE at the start of each run; if another
-- run holds a *fresh* lease, 0 rows update and the worker no-ops for that
-- tick. A stale lease (older than 150s > the 110s run ceiling) is reclaimable
-- so a crashed worker cannot deadlock the queue permanently.
--
-- Why not pg_advisory_lock: PostgREST transaction-pools connections, so a
-- session-level advisory lock would not span the worker's many statements.
-- The lease row is reliable where advisory locks are not.

create table if not exists public.job_worker_lease (
  id        smallint primary key,
  locked_at timestamptz,
  locked_by text,
  constraint job_worker_lease_singleton check (id = 1)
);

insert into public.job_worker_lease (id, locked_at, locked_by)
values (1, null, null)
on conflict (id) do nothing;

-- System control row — not an artifact, not tenant data, not analyst-facing.
-- RLS enabled with NO policies: anon/authenticated are denied; the worker uses
-- the service role, which bypasses RLS. (Provenance Doctrine: this is a
-- 'system' control singleton, not an ownable artifact.)
alter table public.job_worker_lease enable row level security;

comment on table public.job_worker_lease is
  'Single-flight lease for job-worker (INC-JOBWORKER-SATURATION-2026-07-27). One row (id=1). Acquired via atomic conditional UPDATE; a lease older than 150s is reclaimable.';

-- Atomic acquire/release as SQL RPCs. The predicate "free OR stale" lives in
-- plain SQL here rather than as a PostgREST .or() filter on an UPDATE — the
-- REST filter did not match the `locked_at IS NULL` branch, so acquire always
-- returned false and the worker never ran. SECURITY DEFINER + explicit grants
-- restrict execution to the service role (the worker).

create or replace function public.try_acquire_job_worker_lease(
  p_run_id text,
  p_stale_secs int default 150
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.job_worker_lease
     set locked_at = now(), locked_by = p_run_id
   where id = 1
     and (locked_at is null or locked_at < now() - make_interval(secs => p_stale_secs));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_job_worker_lease(p_run_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.job_worker_lease
     set locked_at = null, locked_by = null
   where id = 1 and locked_by = p_run_id;
end;
$$;

revoke all on function public.try_acquire_job_worker_lease(text, int) from public, anon, authenticated;
revoke all on function public.release_job_worker_lease(text) from public, anon, authenticated;
grant execute on function public.try_acquire_job_worker_lease(text, int) to service_role;
grant execute on function public.release_job_worker_lease(text) to service_role;
