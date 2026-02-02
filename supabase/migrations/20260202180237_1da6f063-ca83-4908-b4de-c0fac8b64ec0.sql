-- ============================================
-- CONSORTIUM INTELLIGENCE SHARING INFRASTRUCTURE
-- Standard Police/Military Intel Sharing Model
-- ============================================

-- Traffic Light Protocol (TLP) Classification
-- Based on FIRST (Forum of Incident Response and Security Teams) standard
CREATE TYPE public.tlp_classification AS ENUM (
  'TLP:RED',      -- Not for disclosure, restricted to participants only
  'TLP:AMBER',    -- Limited disclosure, restricted to participants' organizations
  'TLP:AMBER+STRICT', -- Restricted to participants' organizations only (no further sharing)
  'TLP:GREEN',    -- Limited disclosure, restricted to the community
  'TLP:CLEAR'     -- Disclosure is not limited (formerly TLP:WHITE)
);

-- Sharing granularity levels
CREATE TYPE public.sharing_granularity AS ENUM (
  'full',           -- Full facility/entity details shared
  'facility',       -- Facility-level detail (no personnel names)
  'regional',       -- Region-level only (e.g., "Northeast BC")
  'aggregate',      -- Statistics only, no specific incidents
  'none'            -- No sharing
);

-- Consortium membership roles
CREATE TYPE public.consortium_role AS ENUM (
  'owner',          -- Created the consortium, full admin rights
  'administrator',  -- Can manage members and settings
  'full_member',    -- Can share and receive all authorized intel
  'associate',      -- Limited sharing (incidents only)
  'observer'        -- Read-only access to shared intel
);

-- Intelligence product types
CREATE TYPE public.intel_product_type AS ENUM (
  'blof',           -- Business Level Operational Focus
  'intel_briefing', -- Detailed intelligence briefing
  'incident_digest', -- Automated incident summary
  'threat_assessment', -- Threat assessment report
  'situational_report', -- SITREP
  'warning_order',  -- Early warning/WARNORD
  'flash_report'    -- Urgent/Flash traffic
);

-- ============================================
-- CORE CONSORTIUM TABLES
-- ============================================

-- Consortia (intelligence sharing groups)
CREATE TABLE public.consortia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  region TEXT, -- Geographic focus (e.g., "Northern Alberta/BC")
  sector TEXT DEFAULT 'energy', -- Industry sector
  classification_default tlp_classification DEFAULT 'TLP:AMBER',
  sharing_granularity_default sharing_granularity DEFAULT 'regional',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  logo_url TEXT,
  charter_document_url TEXT, -- NDA/Charter document
  metadata JSONB DEFAULT '{}'
);

-- Consortium membership (which tenants/clients are members)
CREATE TABLE public.consortium_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_id UUID NOT NULL REFERENCES public.consortia(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id), -- For tenant-level membership
  client_id UUID REFERENCES public.clients(id), -- For client-level membership
  role consortium_role DEFAULT 'full_member',
  
  -- Sharing preferences (what this member shares OUT)
  sharing_incidents sharing_granularity DEFAULT 'regional',
  sharing_signals sharing_granularity DEFAULT 'aggregate',
  sharing_entities sharing_granularity DEFAULT 'none',
  sharing_investigations sharing_granularity DEFAULT 'none',
  
  -- Classification thresholds (what this member can SEE)
  max_classification tlp_classification DEFAULT 'TLP:AMBER',
  
  -- Membership status
  joined_at TIMESTAMPTZ DEFAULT now(),
  invited_by UUID REFERENCES public.profiles(id),
  is_active BOOLEAN DEFAULT true,
  nda_signed_at TIMESTAMPTZ,
  nda_signatory TEXT,
  
  -- Constraints
  UNIQUE(consortium_id, tenant_id),
  UNIQUE(consortium_id, client_id),
  CHECK (tenant_id IS NOT NULL OR client_id IS NOT NULL)
);

-- Consortium user access (individual users within member orgs)
CREATE TABLE public.consortium_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_member_id UUID NOT NULL REFERENCES public.consortium_members(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  can_share BOOLEAN DEFAULT false, -- Can share intel to consortium
  can_receive BOOLEAN DEFAULT true, -- Can receive shared intel
  can_generate_reports BOOLEAN DEFAULT false, -- Can create BLOF/briefings
  is_point_of_contact BOOLEAN DEFAULT false, -- Primary contact for this org
  granted_at TIMESTAMPTZ DEFAULT now(),
  granted_by UUID REFERENCES public.profiles(id),
  UNIQUE(consortium_member_id, user_id)
);

-- ============================================
-- SHARED INTELLIGENCE TABLES
-- ============================================

-- Shared intelligence products (BLOF, briefings, digests)
CREATE TABLE public.shared_intel_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_id UUID NOT NULL REFERENCES public.consortia(id) ON DELETE CASCADE,
  product_type intel_product_type NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT, -- Full content (may be sanitized)
  content_html TEXT, -- Rich HTML version
  classification tlp_classification DEFAULT 'TLP:AMBER',
  
  -- Time period covered
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  
  -- Authorship
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ,
  is_published BOOLEAN DEFAULT false,
  is_draft BOOLEAN DEFAULT true,
  
  -- Dissemination tracking
  disseminated_at TIMESTAMPTZ,
  dissemination_method TEXT, -- 'email', 'platform', 'both'
  recipient_count INTEGER DEFAULT 0,
  
  -- AI generation metadata
  ai_generated BOOLEAN DEFAULT false,
  source_signals UUID[] DEFAULT '{}',
  source_incidents UUID[] DEFAULT '{}',
  
  -- Attachments and metadata
  attachments JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  
  -- Audio briefing (using OpenAI TTS-1-HD with onyx voice)
  audio_url TEXT,
  audio_generated_at TIMESTAMPTZ
);

-- Shared incidents (anonymized/aggregated view of member incidents)
CREATE TABLE public.shared_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_id UUID NOT NULL REFERENCES public.consortia(id) ON DELETE CASCADE,
  source_incident_id UUID REFERENCES public.incidents(id),
  source_member_id UUID REFERENCES public.consortium_members(id),
  
  -- Anonymized/sanitized fields
  title TEXT NOT NULL,
  description TEXT,
  incident_type TEXT,
  classification tlp_classification DEFAULT 'TLP:AMBER',
  granularity sharing_granularity DEFAULT 'regional',
  
  -- Location (anonymized based on granularity)
  region TEXT, -- Always available
  facility_type TEXT, -- If granularity >= facility
  coordinates JSONB, -- If granularity = full
  
  -- Temporal
  occurred_at TIMESTAMPTZ,
  shared_at TIMESTAMPTZ DEFAULT now(),
  shared_by UUID REFERENCES public.profiles(id),
  
  -- Assessment
  severity TEXT,
  threat_category TEXT,
  modus_operandi TEXT,
  indicators JSONB DEFAULT '[]', -- IOCs, TTPs
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'
);

-- Shared signals (threat indicators shared across consortium)
CREATE TABLE public.shared_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_id UUID NOT NULL REFERENCES public.consortia(id) ON DELETE CASCADE,
  source_signal_id UUID REFERENCES public.signals(id),
  source_member_id UUID REFERENCES public.consortium_members(id),
  
  -- Sanitized content
  title TEXT NOT NULL,
  summary TEXT,
  threat_type TEXT,
  classification tlp_classification DEFAULT 'TLP:GREEN',
  
  -- Regional context
  region TEXT,
  applies_to_sector TEXT DEFAULT 'energy',
  
  -- Timing
  detected_at TIMESTAMPTZ,
  shared_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  
  -- Assessment
  confidence_level TEXT, -- CONFIRMED, PROBABLE, POSSIBLE
  credibility TEXT, -- A-F scale
  relevance_score INTEGER, -- 1-100
  
  -- Indicators
  keywords TEXT[],
  entities_mentioned TEXT[],
  
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'
);

-- ============================================
-- DISSEMINATION AND AUDIT
-- ============================================

-- Dissemination log (who received what, when)
CREATE TABLE public.intel_dissemination_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.shared_intel_products(id) ON DELETE CASCADE,
  shared_incident_id UUID REFERENCES public.shared_incidents(id) ON DELETE CASCADE,
  shared_signal_id UUID REFERENCES public.shared_signals(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES public.profiles(id),
  recipient_member_id UUID REFERENCES public.consortium_members(id),
  
  delivery_method TEXT NOT NULL, -- 'email', 'platform', 'api'
  delivered_at TIMESTAMPTZ DEFAULT now(),
  opened_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  
  -- Email tracking
  email_address TEXT,
  email_status TEXT, -- 'sent', 'delivered', 'opened', 'bounced'
  
  -- Constraints
  CHECK (product_id IS NOT NULL OR shared_incident_id IS NOT NULL OR shared_signal_id IS NOT NULL)
);

-- Consortium audit log
CREATE TABLE public.consortium_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_id UUID NOT NULL REFERENCES public.consortia(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- AUTOMATED SHARING RULES
-- ============================================

-- Auto-share rules (what gets shared automatically)
CREATE TABLE public.consortium_share_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consortium_member_id UUID NOT NULL REFERENCES public.consortium_members(id) ON DELETE CASCADE,
  
  -- What triggers sharing
  trigger_type TEXT NOT NULL, -- 'incident', 'signal', 'entity_mention'
  trigger_conditions JSONB DEFAULT '{}', -- Filter conditions
  
  -- How it's shared
  classification tlp_classification DEFAULT 'TLP:AMBER',
  granularity sharing_granularity DEFAULT 'regional',
  requires_approval BOOLEAN DEFAULT true,
  
  -- Who approves
  approver_user_id UUID REFERENCES public.profiles(id),
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Pending shares (queue for approval)
CREATE TABLE public.pending_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_rule_id UUID REFERENCES public.consortium_share_rules(id) ON DELETE CASCADE,
  consortium_id UUID NOT NULL REFERENCES public.consortia(id) ON DELETE CASCADE,
  source_member_id UUID NOT NULL REFERENCES public.consortium_members(id),
  
  -- Source record
  source_type TEXT NOT NULL, -- 'incident', 'signal'
  source_id UUID NOT NULL,
  
  -- Proposed share details
  proposed_classification tlp_classification,
  proposed_granularity sharing_granularity,
  sanitized_content JSONB DEFAULT '{}',
  
  -- Approval workflow
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'auto_approved'
  submitted_at TIMESTAMPTZ DEFAULT now(),
  submitted_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id),
  rejection_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ENABLE RLS
-- ============================================

ALTER TABLE public.consortia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consortium_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consortium_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_intel_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_dissemination_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consortium_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consortium_share_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_shares ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if user is member of a consortium
CREATE OR REPLACE FUNCTION public.is_consortium_member(_consortium_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consortium_user_access cua
    JOIN public.consortium_members cm ON cm.id = cua.consortium_member_id
    WHERE cm.consortium_id = _consortium_id 
      AND cua.user_id = _user_id
      AND cm.is_active = true
  )
$$;

-- Check if user has specific consortium role
CREATE OR REPLACE FUNCTION public.has_consortium_role(_consortium_id UUID, _user_id UUID, _roles consortium_role[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consortium_user_access cua
    JOIN public.consortium_members cm ON cm.id = cua.consortium_member_id
    WHERE cm.consortium_id = _consortium_id 
      AND cua.user_id = _user_id
      AND cm.role = ANY(_roles)
      AND cm.is_active = true
  )
$$;

-- Check if user can share to consortium
CREATE OR REPLACE FUNCTION public.can_share_to_consortium(_consortium_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consortium_user_access cua
    JOIN public.consortium_members cm ON cm.id = cua.consortium_member_id
    WHERE cm.consortium_id = _consortium_id 
      AND cua.user_id = _user_id
      AND cua.can_share = true
      AND cm.is_active = true
  )
$$;

-- Get user's consortium IDs
CREATE OR REPLACE FUNCTION public.get_user_consortium_ids(_user_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(cm.consortium_id), '{}')
  FROM public.consortium_user_access cua
  JOIN public.consortium_members cm ON cm.id = cua.consortium_member_id
  WHERE cua.user_id = _user_id AND cm.is_active = true
$$;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Consortia: viewable by members, super admins
CREATE POLICY "Users can view consortia they belong to"
ON public.consortia FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR is_consortium_member(id, auth.uid())
);

CREATE POLICY "Consortium owners/admins can update"
ON public.consortia FOR UPDATE
USING (
  is_super_admin(auth.uid())
  OR has_consortium_role(id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
);

CREATE POLICY "Super admins can create consortia"
ON public.consortia FOR INSERT
WITH CHECK (is_super_admin(auth.uid()));

-- Consortium members: viewable by consortium members
CREATE POLICY "Consortium members can view membership"
ON public.consortium_members FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR is_consortium_member(consortium_id, auth.uid())
);

CREATE POLICY "Admins can manage membership"
ON public.consortium_members FOR ALL
USING (
  is_super_admin(auth.uid())
  OR has_consortium_role(consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
);

-- User access: viewable by consortium members
CREATE POLICY "View own consortium user access"
ON public.consortium_user_access FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM consortium_members cm 
    WHERE cm.id = consortium_member_id 
    AND is_consortium_member(cm.consortium_id, auth.uid())
  )
);

CREATE POLICY "Admins can manage user access"
ON public.consortium_user_access FOR ALL
USING (
  is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM consortium_members cm 
    WHERE cm.id = consortium_member_id 
    AND has_consortium_role(cm.consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
  )
);

-- Shared intel products: viewable by consortium members with receive permission
CREATE POLICY "Consortium members can view shared products"
ON public.shared_intel_products FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (
    is_consortium_member(consortium_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM consortium_user_access cua
      JOIN consortium_members cm ON cm.id = cua.consortium_member_id
      WHERE cm.consortium_id = shared_intel_products.consortium_id
      AND cua.user_id = auth.uid()
      AND cua.can_receive = true
    )
  )
);

CREATE POLICY "Authorized users can create products"
ON public.shared_intel_products FOR INSERT
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    is_consortium_member(consortium_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM consortium_user_access cua
      JOIN consortium_members cm ON cm.id = cua.consortium_member_id
      WHERE cm.consortium_id = shared_intel_products.consortium_id
      AND cua.user_id = auth.uid()
      AND cua.can_generate_reports = true
    )
  )
);

CREATE POLICY "Authors can update own products"
ON public.shared_intel_products FOR UPDATE
USING (
  is_super_admin(auth.uid())
  OR created_by = auth.uid()
  OR has_consortium_role(consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
);

-- Shared incidents: viewable by consortium members
CREATE POLICY "Consortium members can view shared incidents"
ON public.shared_incidents FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR is_consortium_member(consortium_id, auth.uid())
);

CREATE POLICY "Sharers can create shared incidents"
ON public.shared_incidents FOR INSERT
WITH CHECK (
  is_super_admin(auth.uid())
  OR can_share_to_consortium(consortium_id, auth.uid())
);

-- Shared signals: viewable by consortium members
CREATE POLICY "Consortium members can view shared signals"
ON public.shared_signals FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR is_consortium_member(consortium_id, auth.uid())
);

CREATE POLICY "Sharers can create shared signals"
ON public.shared_signals FOR INSERT
WITH CHECK (
  is_super_admin(auth.uid())
  OR can_share_to_consortium(consortium_id, auth.uid())
);

-- Dissemination log: viewable by consortium members
CREATE POLICY "Consortium members can view dissemination log"
ON public.intel_dissemination_log FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR recipient_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM shared_intel_products sip 
    WHERE sip.id = product_id 
    AND is_consortium_member(sip.consortium_id, auth.uid())
  )
);

CREATE POLICY "System can insert dissemination records"
ON public.intel_dissemination_log FOR INSERT
WITH CHECK (true); -- Typically inserted by edge functions

-- Audit log: viewable by consortium admins
CREATE POLICY "Admins can view audit log"
ON public.consortium_audit_log FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR has_consortium_role(consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
);

CREATE POLICY "System can insert audit records"
ON public.consortium_audit_log FOR INSERT
WITH CHECK (true);

-- Share rules: viewable by member
CREATE POLICY "Members can view their share rules"
ON public.consortium_share_rules FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM consortium_members cm 
    WHERE cm.id = consortium_member_id 
    AND (
      is_consortium_member(cm.consortium_id, auth.uid())
      OR has_consortium_role(cm.consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
    )
  )
);

CREATE POLICY "Admins can manage share rules"
ON public.consortium_share_rules FOR ALL
USING (
  is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM consortium_members cm 
    WHERE cm.id = consortium_member_id 
    AND can_share_to_consortium(cm.consortium_id, auth.uid())
  )
);

-- Pending shares: viewable by submitter and approvers
CREATE POLICY "View pending shares"
ON public.pending_shares FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR submitted_by = auth.uid()
  OR has_consortium_role(consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
  OR can_share_to_consortium(consortium_id, auth.uid())
);

CREATE POLICY "Sharers can create pending shares"
ON public.pending_shares FOR INSERT
WITH CHECK (
  is_super_admin(auth.uid())
  OR can_share_to_consortium(consortium_id, auth.uid())
);

CREATE POLICY "Admins can update pending shares"
ON public.pending_shares FOR UPDATE
USING (
  is_super_admin(auth.uid())
  OR has_consortium_role(consortium_id, auth.uid(), ARRAY['owner', 'administrator']::consortium_role[])
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_consortium_members_consortium ON public.consortium_members(consortium_id);
CREATE INDEX idx_consortium_members_tenant ON public.consortium_members(tenant_id);
CREATE INDEX idx_consortium_members_client ON public.consortium_members(client_id);
CREATE INDEX idx_consortium_user_access_user ON public.consortium_user_access(user_id);
CREATE INDEX idx_shared_intel_products_consortium ON public.shared_intel_products(consortium_id);
CREATE INDEX idx_shared_intel_products_type ON public.shared_intel_products(product_type);
CREATE INDEX idx_shared_incidents_consortium ON public.shared_incidents(consortium_id);
CREATE INDEX idx_shared_signals_consortium ON public.shared_signals(consortium_id);
CREATE INDEX idx_intel_dissemination_product ON public.intel_dissemination_log(product_id);
CREATE INDEX idx_intel_dissemination_recipient ON public.intel_dissemination_log(recipient_user_id);
CREATE INDEX idx_pending_shares_consortium ON public.pending_shares(consortium_id);
CREATE INDEX idx_pending_shares_status ON public.pending_shares(status);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================

CREATE TRIGGER update_consortia_updated_at
  BEFORE UPDATE ON public.consortia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shared_intel_products_updated_at
  BEFORE UPDATE ON public.shared_intel_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();