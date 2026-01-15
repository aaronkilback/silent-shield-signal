-- 1. Add deleted_at column for soft deletes on incidents
ALTER TABLE public.incidents 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 2. Create incident audit log table
CREATE TABLE public.incident_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored', 'bulk_deleted')),
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT
);

-- Enable RLS on audit log
ALTER TABLE public.incident_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view incident audit logs"
  ON public.incident_audit_log
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Only service role can insert (via edge functions)
CREATE POLICY "Service role can insert audit logs"
  ON public.incident_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Create index for faster queries
CREATE INDEX idx_incident_audit_log_incident_id ON public.incident_audit_log(incident_id);
CREATE INDEX idx_incident_audit_log_performed_at ON public.incident_audit_log(performed_at DESC);
CREATE INDEX idx_incidents_deleted_at ON public.incidents(deleted_at) WHERE deleted_at IS NULL;