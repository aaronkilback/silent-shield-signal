
-- Create security audits table to track user security scans
CREATE TABLE public.user_security_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audit_type TEXT NOT NULL DEFAULT 'full_scan',
  overall_score INTEGER NOT NULL DEFAULT 0,
  breach_count INTEGER DEFAULT 0,
  exposed_passwords INTEGER DEFAULT 0,
  digital_footprint_findings INTEGER DEFAULT 0,
  network_risks TEXT[] DEFAULT '{}',
  recommendations JSONB DEFAULT '[]',
  findings JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.user_security_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audits"
  ON public.user_security_audits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own audits"
  ON public.user_security_audits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create submitted threat analysis requests  
CREATE TABLE public.threat_analysis_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  input_value TEXT NOT NULL,
  result JSONB DEFAULT '{}',
  risk_level TEXT DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.threat_analysis_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own analysis requests"
  ON public.threat_analysis_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own analysis requests"
  ON public.threat_analysis_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can update analysis requests"
  ON public.threat_analysis_requests FOR UPDATE
  USING (true);

CREATE INDEX idx_user_security_audits_user ON public.user_security_audits(user_id);
CREATE INDEX idx_threat_analysis_requests_user ON public.threat_analysis_requests(user_id);
