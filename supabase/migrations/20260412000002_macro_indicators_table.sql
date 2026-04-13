-- =============================================================================
-- Macro Indicators Table
-- Date: 2026-04-12
--
-- Stores daily commodity price readings and prediction market snapshots
-- used by monitor-macro-indicators for trend detection and signal generation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.macro_indicators (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_name TEXT         NOT NULL,  -- e.g., 'copper_spot_usd_per_tonne'
  value         NUMERIC       NOT NULL,
  unit          TEXT          NOT NULL,  -- e.g., 'USD/tonne', 'USD/barrel', 'CAD/L', 'probability_%'
  source        TEXT          NOT NULL,  -- e.g., 'yahoo_finance', 'polymarket'
  region        TEXT,                   -- e.g., 'global', 'canada', 'bc_northeast'
  captured_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  raw_json      JSONB,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Efficient lookups for trend calculation (most recent N readings per indicator)
CREATE INDEX IF NOT EXISTS idx_macro_indicators_name_captured
  ON public.macro_indicators (indicator_name, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_macro_indicators_captured
  ON public.macro_indicators (captured_at DESC);

-- Row level security
ALTER TABLE public.macro_indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to macro_indicators"
  ON public.macro_indicators FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read macro_indicators"
  ON public.macro_indicators FOR SELECT
  TO authenticated
  USING (true);
