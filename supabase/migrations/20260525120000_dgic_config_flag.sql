-- DGIC Phase B — minimal dgic_config table for the runtime rollback flag.
-- Additive, service-role only. NOT DGIC schema/enforcement — just the config row the
-- admission controller reads to decide controller-vs-legacy at runtime.
-- Default flag value = 'false' => legacy (authoritative) path runs until parity + burn-in pass.

CREATE TABLE IF NOT EXISTS public.dgic_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dgic_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dgic_config_service_all ON public.dgic_config;
CREATE POLICY dgic_config_service_all ON public.dgic_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.dgic_config FROM anon, authenticated;

INSERT INTO public.dgic_config (key, value) VALUES
  ('admission_controller_enabled', 'false'),
  ('contract_version', 'v0.2')
ON CONFLICT (key) DO NOTHING;
