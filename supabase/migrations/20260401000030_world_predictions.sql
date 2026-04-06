-- Agent world predictions: active forecasts agents maintain about how situations will evolve
CREATE TABLE IF NOT EXISTS public.agent_world_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_call_sign TEXT NOT NULL,
  prediction_text TEXT NOT NULL,         -- "X will happen by Y"
  domain TEXT NOT NULL,                  -- cyber, physical, geopolitical, etc
  confidence_probability NUMERIC(4,3) NOT NULL CHECK (confidence_probability BETWEEN 0 AND 1),
  time_horizon_hours INTEGER,            -- how many hours until prediction resolves
  expected_by TIMESTAMPTZ,              -- computed: created_at + time_horizon_hours
  triggering_conditions TEXT[],         -- what signals would confirm this
  falsifying_conditions TEXT[],         -- what signals would refute this
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'refuted', 'expired', 'superseded')),
  related_signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  related_incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ,
  refuted_at TIMESTAMPTZ,
  confirmation_signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_predictions_agent ON public.agent_world_predictions(agent_call_sign, status);
CREATE INDEX IF NOT EXISTS idx_world_predictions_active ON public.agent_world_predictions(status, expected_by) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_world_predictions_domain ON public.agent_world_predictions(domain, status);

-- Prediction deviation log: when reality differs from predictions, that IS the intelligence
CREATE TABLE IF NOT EXISTS public.prediction_deviations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prediction_id UUID REFERENCES public.agent_world_predictions(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  deviation_type TEXT NOT NULL CHECK (deviation_type IN ('early_confirmation', 'late_confirmation', 'partial_confirmation', 'contradicting_signal', 'unexpected_escalation')),
  deviation_magnitude NUMERIC(4,3),    -- 0-1, how much does this deviate from prediction
  deviation_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_world_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_deviations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.agent_world_predictions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.prediction_deviations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read" ON public.agent_world_predictions FOR SELECT TO authenticated USING (true);
