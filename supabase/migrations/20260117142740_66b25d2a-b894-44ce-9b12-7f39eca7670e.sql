-- ═══════════════════════════════════════════════════════════════════════════
--                    FORTRESS RELIABILITY FIRST SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- Sources table: stores all source artifacts with tamper-evident hashes
CREATE TABLE public.source_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'url', 'html_snapshot', 'pdf', 'screenshot', 'feed_event', 
    'incident_record', 'log_excerpt', 'satellite_feed', 'financial_quote',
    'internal_document', 'client_report', 'osint_scan'
  )),
  url TEXT,
  title TEXT,
  content_hash TEXT NOT NULL,
  storage_path TEXT,
  retrieved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES public.tenants(id),
  client_id UUID REFERENCES public.clients(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Verification tasks table: tracks what needs confirmation
CREATE TABLE public.verification_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_text TEXT NOT NULL,
  verification_type TEXT NOT NULL CHECK (verification_type IN (
    'source_missing', 'source_outdated', 'conflicting_sources', 
    'low_confidence', 'unverified_claim'
  )),
  where_to_check TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  deadline TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'verified', 'rejected', 'expired')),
  resolution_notes TEXT,
  source_artifact_id UUID REFERENCES public.source_artifacts(id),
  briefing_session_id UUID REFERENCES public.briefing_sessions(id),
  client_id UUID REFERENCES public.clients(id),
  tenant_id UUID REFERENCES public.tenants(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Briefing claims table: links claims to sources
CREATE TABLE public.briefing_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_session_id UUID REFERENCES public.briefing_sessions(id),
  agent_message_id UUID REFERENCES public.agent_messages(id),
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'fact', 'statistic', 'quote', 'date', 'location', 'entity_mention', 'assessment'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('internal', 'external', 'derived', 'unverified')),
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low', 'unverified')),
  confidence_rationale TEXT,
  citation_key TEXT NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  verification_task_id UUID REFERENCES public.verification_tasks(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Junction table: claims to sources (many-to-many)
CREATE TABLE public.claim_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES public.briefing_claims(id) ON DELETE CASCADE,
  source_artifact_id UUID NOT NULL REFERENCES public.source_artifacts(id),
  relevance_score NUMERIC(3,2) DEFAULT 1.0,
  is_primary_source BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(claim_id, source_artifact_id)
);

-- Reliability settings per client
CREATE TABLE public.reliability_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  tenant_id UUID REFERENCES public.tenants(id),
  reliability_first_enabled BOOLEAN DEFAULT true,
  require_min_sources INTEGER DEFAULT 1,
  require_snapshot_for_external BOOLEAN DEFAULT true,
  auto_create_verification_tasks BOOLEAN DEFAULT true,
  block_unverified_claims BOOLEAN DEFAULT true,
  max_source_age_hours INTEGER DEFAULT 72,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);

-- Enable RLS
ALTER TABLE public.source_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reliability_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view source artifacts in their tenant" ON public.source_artifacts
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id IS NULL
  );

CREATE POLICY "Users can create source artifacts" ON public.source_artifacts
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id IS NULL
  );

CREATE POLICY "Users can view verification tasks in their tenant" ON public.verification_tasks
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage verification tasks" ON public.verification_tasks
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can view briefing claims" ON public.briefing_claims
  FOR SELECT USING (true);

CREATE POLICY "Users can view claim sources" ON public.claim_sources
  FOR SELECT USING (true);

CREATE POLICY "Users can view reliability settings" ON public.reliability_settings
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update reliability settings" ON public.reliability_settings
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

-- Create indexes for performance
CREATE INDEX idx_source_artifacts_client ON public.source_artifacts(client_id);
CREATE INDEX idx_source_artifacts_hash ON public.source_artifacts(content_hash);
CREATE INDEX idx_source_artifacts_retrieved ON public.source_artifacts(retrieved_at DESC);
CREATE INDEX idx_verification_tasks_status ON public.verification_tasks(status);
CREATE INDEX idx_verification_tasks_client ON public.verification_tasks(client_id);
CREATE INDEX idx_briefing_claims_session ON public.briefing_claims(briefing_session_id);
CREATE INDEX idx_claim_sources_claim ON public.claim_sources(claim_id);

-- Trigger for updated_at
CREATE TRIGGER update_source_artifacts_updated_at
  BEFORE UPDATE ON public.source_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_verification_tasks_updated_at
  BEFORE UPDATE ON public.verification_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reliability_settings_updated_at
  BEFORE UPDATE ON public.reliability_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for source snapshots
INSERT INTO storage.buckets (id, name, public)
VALUES ('source-snapshots', 'source-snapshots', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for source snapshots
CREATE POLICY "Authenticated users can view snapshots" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'source-snapshots');

CREATE POLICY "Service role can upload snapshots" ON storage.objects
  FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'source-snapshots');