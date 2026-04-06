-- Entity Watch List — tracks persons of interest and active threat actors
-- When a watched entity appears in a new signal, its severity score is boosted
-- and an immediate notification is sent.

CREATE TABLE public.entity_watch_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_name TEXT NOT NULL,
  entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  watch_level TEXT NOT NULL DEFAULT 'monitor'
    CHECK (watch_level IN ('monitor', 'alert', 'critical')),
  reason TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_by_type TEXT NOT NULL DEFAULT 'agent'
    CHECK (added_by_type IN ('agent', 'user')),
  expiry_date TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  severity_boost INTEGER NOT NULL DEFAULT 15
    CHECK (severity_boost BETWEEN 0 AND 50),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watch_list_active ON public.entity_watch_list(is_active, watch_level);
CREATE INDEX idx_watch_list_client ON public.entity_watch_list(client_id);
CREATE INDEX idx_watch_list_expiry ON public.entity_watch_list(expiry_date)
  WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_watch_list_name ON public.entity_watch_list(entity_name);

ALTER TABLE public.entity_watch_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_bypass_watch_list"
  ON public.entity_watch_list FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "authenticated_read_watch_list"
  ON public.entity_watch_list FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role_manage_watch_list"
  ON public.entity_watch_list FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Auto-deactivate expired entries (called by fortress-loop-closer)
CREATE OR REPLACE FUNCTION public.expire_watch_list_entries()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE expired_count INTEGER;
BEGIN
  UPDATE entity_watch_list
    SET is_active = false, updated_at = now()
  WHERE is_active = true AND expiry_date IS NOT NULL AND expiry_date < now();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;
