-- WO-GATE-PHASE3 slice 5: 30-day retention on the shadow table, DECIDED UP FRONT (Phase 2 discipline —
-- retention is part of the substrate, not an afterthought once compare data arrives). Pure-SQL nightly
-- cron, same pattern as purge-ingest-decisions-nightly (unregistered maintenance delete — no producer
-- contract/heartbeat). 30 days >> the 7-day compare window; forward-only shadow data. 04:23 UTC to
-- avoid collision with purge-ingest-decisions-nightly (04:17).
select cron.schedule(
  'purge-ingest-shadow-nightly',
  '23 4 * * *',
  $$ delete from public.ingest_shadow where first_seen_at < now() - interval '30 days' $$
);
