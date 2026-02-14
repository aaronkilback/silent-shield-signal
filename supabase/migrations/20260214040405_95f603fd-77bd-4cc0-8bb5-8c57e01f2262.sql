
CREATE TABLE public.operator_heartbeats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL DEFAULT 'mobile',
  device_label TEXT,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ip_address TEXT,
  is_online BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_type)
);

ALTER TABLE public.operator_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own heartbeats"
  ON public.operator_heartbeats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own heartbeats"
  ON public.operator_heartbeats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own heartbeats"
  ON public.operator_heartbeats FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all heartbeats"
  ON public.operator_heartbeats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );
