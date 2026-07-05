-- WO-B synthetic-client-skip-guard (2026-07-04)
-- Visible reject-log for the ingest-signal write seam. When a LIVE signal
-- (is_test !== true) is routed to an is_test client (synthetic / benchmark /
-- QA fixture), ingest-signal does NOT write it to that client — it records the
-- rejection here instead. This makes misroutes VISIBLE rather than either
-- silently absorbed onto a synthetic client (the drift, e.g. BCWS wildfire
-- 17a006a2 -> _benchmark_petronas) or silently dropped (the deleter class).
-- Re-resolution to the correct real client is deferred to WO-A canonical routing.
CREATE TABLE IF NOT EXISTS public.misrouted_signals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  intended_client_id      uuid,
  intended_client_name    text,
  intended_client_is_test boolean,
  source_key              text,
  source_url              text,
  signal_text             text,
  reason                  text NOT NULL,
  caller_kind             text,
  raw_payload             jsonb
);

COMMENT ON TABLE public.misrouted_signals IS
  'Visible reject-log: signals blocked at ingest-signal because routed to an is_test client. WO-B synthetic-client-skip-guard 2026-07-04. Re-resolution = WO-A. Never a silent drop.';

CREATE INDEX IF NOT EXISTS misrouted_signals_created_at_idx
  ON public.misrouted_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS misrouted_signals_intended_client_idx
  ON public.misrouted_signals (intended_client_id);

-- Fail-closed: service_role (sole writer + operator read path) bypasses RLS;
-- no anon/authenticated policy is granted. Phase 1.6 doctrine — do NOT reuse
-- the roles=public / qual=true pattern.
ALTER TABLE public.misrouted_signals ENABLE ROW LEVEL SECURITY;
