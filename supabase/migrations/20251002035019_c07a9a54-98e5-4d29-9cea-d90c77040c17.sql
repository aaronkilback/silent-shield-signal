-- Create escalation rules table
CREATE TABLE IF NOT EXISTS public.escalation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('p1', 'p2', 'p3', 'p4')),
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  escalate_after_minutes INTEGER NOT NULL DEFAULT 60,
  notify_recipients TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.escalation_rules ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "All authenticated users can view escalation rules"
  ON public.escalation_rules
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Analysts and admins can manage escalation rules"
  ON public.escalation_rules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'analyst')
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_escalation_rules_updated_at
  BEFORE UPDATE ON public.escalation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default escalation rules
INSERT INTO public.escalation_rules (name, description, priority, conditions, actions, escalate_after_minutes, notify_recipients) VALUES
('P1 Immediate Escalation', 'Critical incidents escalate to leadership immediately', 'p1', 
 '{"status": "open", "priority": "p1", "no_acknowledgment": true}'::jsonb,
 '{"escalate_to": ["leadership@example.com"], "auto_assign": true, "create_alert": true}'::jsonb,
 15,
 ARRAY['security-team@example.com', 'ciso@example.com']),

('P2 Rapid Escalation', 'High priority incidents escalate after 30 minutes', 'p2',
 '{"status": "open", "priority": "p2", "no_response": true}'::jsonb,
 '{"escalate_priority": "p1", "notify_team": true, "auto_assign": true}'::jsonb,
 30,
 ARRAY['security-team@example.com']),

('Stale Incident Escalation', 'Any open incident older than 24 hours', 'p3',
 '{"status": "open", "age_hours": 24}'::jsonb,
 '{"escalate_priority": true, "send_reminder": true}'::jsonb,
 1440,
 ARRAY['security-team@example.com']),

('False Positive Pattern', 'Auto-close similar false positives', 'p4',
 '{"false_positive_pattern": true, "confidence": 0.8}'::jsonb,
 '{"auto_close": true, "log_pattern": true}'::jsonb,
 60,
 ARRAY['analyst@example.com']);

-- Update auto-orchestrator to use escalation rules
-- Add new scheduled job for social media monitoring
SELECT cron.schedule(
  'social-monitor-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/monitor-social',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Add scheduled job for threat intelligence monitoring
SELECT cron.schedule(
  'threat-intel-60min',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/monitor-threat-intel',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

COMMENT ON TABLE public.escalation_rules IS 'Configurable escalation rules for autonomous incident management';