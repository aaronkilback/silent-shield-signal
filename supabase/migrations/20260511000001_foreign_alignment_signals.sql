-- Foreign-alignment scoring on signals.
--
-- Driven by the Vashouk / @NeoIntel7 case (2026-05-11): pattern of
-- a former employee whose grievance is amplified by ideological
-- alignment with foreign state-media narratives. The 3Si report's
-- Iranian-affiliation concern would have surfaced earlier if
-- Fortress was tagging signals with foreign-alignment indicators.
--
-- Approach: two columns added to signals + an indicator-tag table.
-- Population happens in ingest-signal via a shared helper that does
-- keyword + account-mention matching against known state-media
-- handles and rhetoric phrases. AI scoring is a follow-up — start
-- deterministic so false positives are explainable.

BEGIN;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS foreign_alignment_score      numeric
    CHECK (foreign_alignment_score IS NULL OR (foreign_alignment_score >= 0 AND foreign_alignment_score <= 1)),
  ADD COLUMN IF NOT EXISTS foreign_alignment_indicators text[] DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS signals_foreign_alignment_idx
  ON public.signals(foreign_alignment_score)
  WHERE foreign_alignment_score IS NOT NULL AND foreign_alignment_score > 0;

-- Partial index for high-alignment signals — these are the rare cases
-- that warrant pattern-detection follow-up.
CREATE INDEX IF NOT EXISTS signals_high_alignment_idx
  ON public.signals(client_id, created_at DESC)
  WHERE foreign_alignment_score IS NOT NULL AND foreign_alignment_score >= 0.5;

COMMIT;
