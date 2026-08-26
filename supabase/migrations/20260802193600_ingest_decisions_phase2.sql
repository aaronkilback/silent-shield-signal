-- WO-GATE-KEYWORD-PRESCORE-01 Phase 2: per-item ingest funnel instrumentation (RSS path).
-- Applied to prod 2026-08-02 via MCP apply_migration; committed here for git/DR parity.
-- Forward-only, no backfill. RLS enabled at creation (RLS-at-Creation standing rule) — writers are
-- service-role/SECURITY DEFINER, readers are service-role (watchdog/analytics); deny-by-default.
CREATE TABLE IF NOT EXISTS public.ingest_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL,
  source_id         uuid NOT NULL REFERENCES public.sources(id),
  item_title        text,
  item_url          text,
  content_hash      text NOT NULL,               -- sha256(title || url)
  stage             text NOT NULL,               -- parse | client_match | relevance_score | insert
  outcome           text NOT NULL,               -- passed | dropped
  drop_reason       text,                        -- null when outcome='passed'
  scorer_reached    boolean NOT NULL DEFAULT false,
  relevance_score   numeric,                     -- NULL = never scored. 0 = scored zero. Never coalesce.
  clients_evaluated uuid[],
  client_matched    uuid,
  matched_keyword   text,                        -- literal phrase that matched, null if none
  seen_count        integer NOT NULL DEFAULT 1,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingest_decisions_stage_check   CHECK (stage   IN ('parse','client_match','relevance_score','insert')),
  CONSTRAINT ingest_decisions_outcome_check CHECK (outcome IN ('passed','dropped'))
);
ALTER TABLE public.ingest_decisions ENABLE ROW LEVEL SECURITY;
-- DEVIATION FROM SPEC (flagged): unique on (source_id, content_hash, STAGE) not (source_id, content_hash).
-- The section-8 funnel query counts per stage, so it needs one row per item PER stage; a single-row-
-- per-item design makes that query return zeros. Re-offers upsert-increment per (item, stage).
CREATE UNIQUE INDEX IF NOT EXISTS ingest_decisions_item_stage_uq ON public.ingest_decisions(source_id, content_hash, stage);
CREATE INDEX IF NOT EXISTS ingest_decisions_source_first_seen ON public.ingest_decisions(source_id, first_seen_at);
CREATE INDEX IF NOT EXISTS ingest_decisions_stage_outcome     ON public.ingest_decisions(stage, outcome);
CREATE INDEX IF NOT EXISTS ingest_decisions_first_seen        ON public.ingest_decisions(first_seen_at);

-- Insert-or-increment. On conflict, bump seen_count + last_seen_at ONLY — never overwrite the original decision.
CREATE OR REPLACE FUNCTION public.record_ingest_decision(
  p_run_id uuid, p_source_id uuid, p_item_title text, p_item_url text, p_content_hash text,
  p_stage text, p_outcome text, p_drop_reason text, p_scorer_reached boolean,
  p_relevance_score numeric, p_clients_evaluated uuid[], p_client_matched uuid, p_matched_keyword text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.ingest_decisions
    (run_id, source_id, item_title, item_url, content_hash, stage, outcome, drop_reason,
     scorer_reached, relevance_score, clients_evaluated, client_matched, matched_keyword)
  VALUES
    (p_run_id, p_source_id, left(p_item_title, 500), p_item_url, p_content_hash, p_stage, p_outcome, p_drop_reason,
     coalesce(p_scorer_reached, false), p_relevance_score, p_clients_evaluated, p_client_matched, p_matched_keyword)
  ON CONFLICT (source_id, content_hash, stage)
  DO UPDATE SET seen_count = public.ingest_decisions.seen_count + 1, last_seen_at = now();
$$;
