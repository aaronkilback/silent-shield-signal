
-- =====================================================
-- CYBER SENTINEL AGENT — Database Schema
-- =====================================================

-- Tripwire configurations (detection rules)
CREATE TABLE public.cyber_tripwires (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tripwire_type TEXT NOT NULL DEFAULT 'auth_attack',
  -- Types: auth_attack, api_abuse, data_exfiltration, injection_attempt, anomalous_access, brute_force
  detection_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- e.g. {"max_failed_logins": 5, "window_minutes": 10, "ip_threshold": 3}
  response_tier TEXT NOT NULL DEFAULT 'alert',
  -- Graduated: monitor, warn, throttle, block, lockdown
  severity TEXT NOT NULL DEFAULT 'medium',
  -- low, medium, high, critical
  is_active BOOLEAN NOT NULL DEFAULT true,
  cooldown_minutes INTEGER NOT NULL DEFAULT 15,
  created_by UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES public.tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detected threat events
CREATE TABLE public.cyber_threat_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tripwire_id UUID REFERENCES public.cyber_tripwires(id),
  event_type TEXT NOT NULL,
  -- auth_brute_force, credential_stuffing, api_rate_violation, bulk_data_query,
  -- injection_attempt, unauthorized_endpoint, session_anomaly, ip_reputation
  severity TEXT NOT NULL DEFAULT 'medium',
  confidence_score NUMERIC NOT NULL DEFAULT 0.5,
  -- 0.0 to 1.0, determines response tier
  threat_source JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {"ip": "1.2.3.4", "user_agent": "...", "user_id": "...", "geo": "..."}
  threat_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {"failed_attempts": 12, "targeted_accounts": ["..."], "pattern": "sequential"}
  response_taken TEXT NOT NULL DEFAULT 'logged',
  -- logged, alerted, throttled, blocked, lockdown
  response_details JSONB DEFAULT '{}'::jsonb,
  -- {"blocked_ip": "1.2.3.4", "session_terminated": true, "notification_sent": true}
  ai_analysis TEXT,
  -- AI-generated threat narrative
  related_event_ids UUID[] DEFAULT '{}',
  -- Correlated events for attack chain detection
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  tenant_id UUID REFERENCES public.tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sentinel sweep results (scheduled analysis)
CREATE TABLE public.cyber_sentinel_sweeps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sweep_type TEXT NOT NULL DEFAULT 'scheduled',
  -- scheduled, triggered, manual
  findings_count INTEGER NOT NULL DEFAULT 0,
  threats_detected INTEGER NOT NULL DEFAULT 0,
  responses_executed INTEGER NOT NULL DEFAULT 0,
  sweep_summary TEXT,
  ai_assessment TEXT,
  telemetry JSONB DEFAULT '{}'::jsonb,
  -- {"auth_events_scanned": 500, "api_calls_analyzed": 1200, "duration_ms": 3400}
  status TEXT NOT NULL DEFAULT 'running',
  -- running, completed, failed
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cyber_tripwires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cyber_threat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cyber_sentinel_sweeps ENABLE ROW LEVEL SECURITY;

-- Tripwires: admins/super_admins can manage, analysts can read
CREATE POLICY "Authorized roles can read tripwires"
ON public.cyber_tripwires FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can manage tripwires"
ON public.cyber_tripwires FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Threat events: analysts+ can read, admins can manage
CREATE POLICY "Authorized roles can read threat events"
ON public.cyber_threat_events FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can manage threat events"
ON public.cyber_threat_events FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Sweep results: admins/super_admins only
CREATE POLICY "Admins can read sweeps"
ON public.cyber_sentinel_sweeps FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "System can manage sweeps"
ON public.cyber_sentinel_sweeps FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'super_admin'::app_role)
);

-- Seed default tripwires
INSERT INTO public.cyber_tripwires (name, description, tripwire_type, detection_config, response_tier, severity) VALUES
(
  'Brute Force Login Detection',
  'Detects rapid failed login attempts from single IP or targeting single account',
  'brute_force',
  '{"max_failed_logins": 5, "window_minutes": 10, "per_ip_threshold": 10, "per_account_threshold": 5}'::jsonb,
  'throttle',
  'high'
),
(
  'Credential Stuffing Pattern',
  'Detects multiple failed logins across different accounts from similar sources',
  'auth_attack',
  '{"min_unique_accounts": 3, "window_minutes": 30, "max_success_rate": 0.2, "user_agent_similarity_threshold": 0.8}'::jsonb,
  'block',
  'critical'
),
(
  'API Rate Anomaly',
  'Detects abnormal API call volumes exceeding baseline by 3x+',
  'api_abuse',
  '{"baseline_multiplier": 3, "window_minutes": 5, "min_absolute_calls": 100, "exclude_healthchecks": true}'::jsonb,
  'throttle',
  'medium'
),
(
  'Bulk Data Extraction',
  'Detects unusual large-volume SELECT queries or rapid sequential reads',
  'data_exfiltration',
  '{"max_rows_per_minute": 5000, "max_tables_per_session": 10, "window_minutes": 15, "alert_on_export": true}'::jsonb,
  'alert',
  'high'
),
(
  'SQL Injection Probe',
  'Detects common injection patterns in API parameters and edge function inputs',
  'injection_attempt',
  '{"patterns": ["UNION SELECT", "OR 1=1", "DROP TABLE", "xp_cmdshell", "<script>", "javascript:"], "case_sensitive": false}'::jsonb,
  'block',
  'critical'
),
(
  'Unauthorized Endpoint Probing',
  'Detects systematic scanning of non-existent or restricted API endpoints',
  'anomalous_access',
  '{"max_404s_per_ip": 10, "window_minutes": 5, "track_sequential_paths": true}'::jsonb,
  'warn',
  'medium'
),
(
  'Off-Hours Admin Access',
  'Detects admin-level operations outside normal business hours',
  'anomalous_access',
  '{"business_hours_start": 6, "business_hours_end": 22, "timezone": "America/Edmonton", "admin_roles_only": true}'::jsonb,
  'alert',
  'low'
),
(
  'Session Anomaly Detection',
  'Detects impossible travel or concurrent sessions from disparate geolocations',
  'auth_attack',
  '{"max_concurrent_geos": 2, "impossible_travel_km_per_hour": 1000, "session_fingerprint_mismatch": true}'::jsonb,
  'warn',
  'high'
);

-- Indexes for performance
CREATE INDEX idx_cyber_threat_events_type ON public.cyber_threat_events(event_type);
CREATE INDEX idx_cyber_threat_events_severity ON public.cyber_threat_events(severity);
CREATE INDEX idx_cyber_threat_events_created ON public.cyber_threat_events(created_at DESC);
CREATE INDEX idx_cyber_threat_events_resolved ON public.cyber_threat_events(is_resolved);
CREATE INDEX idx_cyber_tripwires_active ON public.cyber_tripwires(is_active);
CREATE INDEX idx_cyber_sentinel_sweeps_status ON public.cyber_sentinel_sweeps(status);

-- Updated_at triggers
CREATE TRIGGER update_cyber_tripwires_updated_at
BEFORE UPDATE ON public.cyber_tripwires
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cyber_threat_events_updated_at
BEFORE UPDATE ON public.cyber_threat_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
