
-- Table to store pre-investigation compliance checklists
CREATE TABLE public.investigation_compliance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_type TEXT NOT NULL DEFAULT 'vip_deep_scan', -- vip_deep_scan, entity_deep_scan, osint_scan
  target_name TEXT NOT NULL,
  target_id TEXT, -- entity_id or client_id
  user_id UUID REFERENCES auth.users(id),
  checklist JSONB NOT NULL DEFAULT '{}',
  jurisdiction TEXT,
  legal_basis TEXT,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investigation_compliance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view compliance records"
  ON public.investigation_compliance FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create compliance records"
  ON public.investigation_compliance FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own compliance records"
  ON public.investigation_compliance FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_investigation_compliance_updated_at
  BEFORE UPDATE ON public.investigation_compliance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
