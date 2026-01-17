-- ============================================
-- GUARDIAN AGENT PHASE 1: CONTENT MODERATION
-- ============================================

-- Blocked terms/phrases for content moderation
CREATE TABLE public.blocked_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('profanity', 'threat', 'harassment', 'pii', 'security_risk', 'misinformation')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'block', 'escalate')),
  is_regex BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Content violations detected by Guardian
CREATE TABLE public.content_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('chat_message', 'document', 'report', 'comment', 'other')),
  content_excerpt TEXT, -- Redacted excerpt for context
  matched_term_id UUID REFERENCES public.blocked_terms(id),
  matched_pattern TEXT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  action_taken TEXT NOT NULL CHECK (action_taken IN ('warned', 'blocked', 'escalated', 'pending_review')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User-submitted violation reports
CREATE TABLE public.violation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES auth.users(id) NOT NULL,
  reported_user_id UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES public.tenants(id),
  content_type TEXT NOT NULL,
  content_id UUID, -- Reference to the offending content
  content_excerpt TEXT,
  violation_category TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'investigating', 'confirmed', 'dismissed', 'actioned')),
  assigned_to UUID REFERENCES auth.users(id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- User conduct tracking for escalation
CREATE TABLE public.user_conduct_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id),
  violation_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  last_violation_at TIMESTAMPTZ,
  last_warning_at TIMESTAMPTZ,
  suspension_count INTEGER DEFAULT 0,
  current_suspension_until TIMESTAMPTZ,
  is_permanently_banned BOOLEAN DEFAULT false,
  banned_at TIMESTAMPTZ,
  banned_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, tenant_id)
);

-- Rate limiting tracking
CREATE TABLE public.rate_limit_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  action_type TEXT NOT NULL, -- 'agent_message', 'report', 'api_call', etc.
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER DEFAULT 1,
  UNIQUE(user_id, action_type, window_start)
);

-- Enable RLS
ALTER TABLE public.blocked_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_conduct_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_tracking ENABLE ROW LEVEL SECURITY;

-- Blocked terms: Only super admins can manage, all authenticated can read
CREATE POLICY "Authenticated users can read active blocked terms"
  ON public.blocked_terms FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Super admins can manage blocked terms"
  ON public.blocked_terms FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Content violations: Users see their own, admins see all
CREATE POLICY "Users can view their own violations"
  ON public.content_violations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all violations"
  ON public.content_violations FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "System can insert violations"
  ON public.content_violations FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can update violations"
  ON public.content_violations FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Violation reports: Users can create and view their own, admins see all
CREATE POLICY "Users can create reports"
  ON public.violation_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Users can view their own reports"
  ON public.violation_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY "Admins can view all reports"
  ON public.violation_reports FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update reports"
  ON public.violation_reports FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- User conduct: Users see their own, admins see all
CREATE POLICY "Users can view their own conduct record"
  ON public.user_conduct_records FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage conduct records"
  ON public.user_conduct_records FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Rate limiting: Users see their own
CREATE POLICY "Users can view their own rate limits"
  ON public.rate_limit_tracking FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can manage rate limits"
  ON public.rate_limit_tracking FOR ALL TO authenticated
  WITH CHECK (true);

-- Insert some default blocked terms
INSERT INTO public.blocked_terms (term, category, severity, is_regex) VALUES
  -- Threats
  ('kill you', 'threat', 'escalate', false),
  ('gonna hurt', 'threat', 'escalate', false),
  ('death threat', 'threat', 'escalate', false),
  -- Security risks
  ('password is', 'security_risk', 'block', false),
  ('api key', 'security_risk', 'warning', false),
  ('secret key', 'security_risk', 'warning', false),
  -- PII patterns (as warnings)
  ('social security', 'pii', 'warning', false),
  ('credit card', 'pii', 'warning', false);

-- Function to check and update rate limits
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id UUID,
  p_action_type TEXT,
  p_max_requests INTEGER,
  p_window_minutes INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
BEGIN
  -- Calculate window start (truncate to minute boundary)
  v_window_start := date_trunc('minute', now()) - (EXTRACT(MINUTE FROM now())::INTEGER % p_window_minutes) * INTERVAL '1 minute';
  
  -- Try to insert or update the rate limit record
  INSERT INTO public.rate_limit_tracking (user_id, action_type, window_start, request_count)
  VALUES (p_user_id, p_action_type, v_window_start, 1)
  ON CONFLICT (user_id, action_type, window_start)
  DO UPDATE SET request_count = rate_limit_tracking.request_count + 1
  RETURNING request_count INTO v_current_count;
  
  -- Return true if within limit, false if exceeded
  RETURN v_current_count <= p_max_requests;
END;
$$;

-- Function to record a violation and update conduct
CREATE OR REPLACE FUNCTION public.record_violation(
  p_user_id UUID,
  p_tenant_id UUID,
  p_content_type TEXT,
  p_content_excerpt TEXT,
  p_category TEXT,
  p_severity TEXT,
  p_matched_pattern TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_violation_id UUID;
  v_action TEXT;
BEGIN
  -- Determine action based on severity
  v_action := CASE p_severity
    WHEN 'warning' THEN 'warned'
    WHEN 'block' THEN 'blocked'
    WHEN 'escalate' THEN 'escalated'
    ELSE 'pending_review'
  END;
  
  -- Insert the violation
  INSERT INTO public.content_violations (
    user_id, tenant_id, content_type, content_excerpt,
    matched_pattern, category, severity, action_taken
  ) VALUES (
    p_user_id, p_tenant_id, p_content_type, p_content_excerpt,
    p_matched_pattern, p_category, p_severity, v_action
  ) RETURNING id INTO v_violation_id;
  
  -- Update or insert conduct record
  INSERT INTO public.user_conduct_records (user_id, tenant_id, violation_count, last_violation_at)
  VALUES (p_user_id, p_tenant_id, 1, now())
  ON CONFLICT (user_id, tenant_id)
  DO UPDATE SET
    violation_count = user_conduct_records.violation_count + 1,
    last_violation_at = now(),
    warning_count = CASE WHEN p_severity = 'warning' THEN user_conduct_records.warning_count + 1 ELSE user_conduct_records.warning_count END,
    last_warning_at = CASE WHEN p_severity = 'warning' THEN now() ELSE user_conduct_records.last_warning_at END,
    updated_at = now();
  
  RETURN v_violation_id;
END;
$$;