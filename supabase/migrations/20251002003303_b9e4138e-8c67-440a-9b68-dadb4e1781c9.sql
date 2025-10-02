-- Create clients table for onboarding data
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  organization TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  industry TEXT,
  employee_count INTEGER,
  locations TEXT[],
  high_value_assets TEXT[],
  threat_profile JSONB,
  risk_assessment JSONB,
  onboarding_data JSONB,
  status TEXT NOT NULL DEFAULT 'onboarding',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Admins and analysts can manage clients
CREATE POLICY "Admins and analysts can manage clients" ON public.clients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'analyst')
    )
  );

-- All authenticated users can view clients
CREATE POLICY "All authenticated users can view clients" ON public.clients
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Create index for client queries
CREATE INDEX idx_clients_status ON public.clients(status);
CREATE INDEX idx_clients_name ON public.clients(name);

-- Add updated_at trigger
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link signals and incidents to clients
ALTER TABLE public.signals ADD COLUMN client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.incidents ADD COLUMN client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX idx_signals_client_id ON public.signals(client_id);
CREATE INDEX idx_incidents_client_id ON public.incidents(client_id);