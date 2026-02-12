
-- Report archive: persist every generated report
CREATE TABLE public.generated_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  client_id UUID REFERENCES public.clients(id),
  report_type TEXT NOT NULL, -- 'executive', 'risk_snapshot', 'security_bulletin'
  title TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  html_content TEXT NOT NULL,
  pdf_storage_path TEXT, -- path in storage bucket
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

-- Users can view their own reports + admins/super_admins see all
CREATE POLICY "Users can view own reports"
  ON public.generated_reports FOR SELECT
  USING (
    auth.uid() = user_id 
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Users can create own reports"
  ON public.generated_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
  ON public.generated_reports FOR DELETE
  USING (
    auth.uid() = user_id 
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Indexes for fast lookups
CREATE INDEX idx_generated_reports_user_id ON public.generated_reports(user_id);
CREATE INDEX idx_generated_reports_client_id ON public.generated_reports(client_id);
CREATE INDEX idx_generated_reports_type ON public.generated_reports(report_type);
CREATE INDEX idx_generated_reports_created_at ON public.generated_reports(created_at DESC);

-- Report schedules: automated recurring report delivery
CREATE TABLE public.report_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  client_id UUID NOT NULL REFERENCES public.clients(id),
  report_type TEXT NOT NULL, -- 'executive', 'risk_snapshot', 'security_bulletin'
  frequency TEXT NOT NULL DEFAULT 'weekly', -- 'daily', 'weekly', 'biweekly', 'monthly'
  day_of_week INTEGER DEFAULT 1, -- 0=Sunday, 1=Monday, etc.
  hour_utc INTEGER NOT NULL DEFAULT 13, -- Hour in UTC (13 = 6am Calgary)
  email_recipients TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}', -- period_days, template preferences, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own schedules"
  ON public.report_schedules FOR ALL
  USING (
    auth.uid() = user_id 
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE INDEX idx_report_schedules_next_run ON public.report_schedules(next_run_at) WHERE is_active = true;
CREATE INDEX idx_report_schedules_user_id ON public.report_schedules(user_id);

-- Storage bucket for server-generated PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('generated-reports', 'generated-reports', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: users can access their own report files
CREATE POLICY "Users can view own report files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'generated-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can insert report files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'generated-reports');
