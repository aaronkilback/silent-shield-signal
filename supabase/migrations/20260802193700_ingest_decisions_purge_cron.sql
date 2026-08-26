-- WO-GATE Phase 2 §4: 180-day retention. Nightly purge on first_seen_at.
-- Applied to prod 2026-08-02 via MCP; committed here for git/DR parity.
select cron.schedule(
  'purge-ingest-decisions-nightly',
  '17 4 * * *',
  $$ delete from public.ingest_decisions where first_seen_at < now() - interval '180 days' $$
);
