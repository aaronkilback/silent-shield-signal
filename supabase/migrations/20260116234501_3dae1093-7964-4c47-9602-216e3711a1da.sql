
-- Enable pgvector extension first
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- MULTI-TENANT ARCHITECTURE FOR FORTRESS/AEGIS
-- =====================================================

-- 1. Create tenant role enum
CREATE TYPE public.tenant_role AS ENUM ('owner', 'admin', 'analyst', 'viewer');

-- 2. Create tenants table
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create tenant_users (membership) table
CREATE TABLE public.tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role tenant_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- 4. Create tenant_invites table
CREATE TABLE public.tenant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role tenant_role NOT NULL DEFAULT 'viewer',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Create audit_events table
CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Create global knowledge tables (NO tenant_id)
CREATE TABLE public.global_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  content_hash TEXT,
  file_path TEXT,
  file_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.global_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES public.global_docs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Create tenant-scoped knowledge tables
CREATE TABLE public.tenant_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  content_hash TEXT,
  file_path TEXT,
  file_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES public.tenant_docs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Create agent_memory with scope constraints
CREATE TABLE public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'tenant')),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  importance_score NUMERIC(3,2) DEFAULT 0.5,
  context_tags TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- CRITICAL: Enforce scope/tenant_id constraints
  CONSTRAINT scope_tenant_check CHECK (
    (scope = 'global' AND tenant_id IS NULL) OR
    (scope = 'tenant' AND tenant_id IS NOT NULL)
  )
);

-- 9. Create indexes
CREATE INDEX idx_tenant_users_user_id ON public.tenant_users(user_id);
CREATE INDEX idx_tenant_users_tenant_id ON public.tenant_users(tenant_id);
CREATE INDEX idx_tenant_invites_email ON public.tenant_invites(email);
CREATE INDEX idx_tenant_invites_token_hash ON public.tenant_invites(token_hash);
CREATE INDEX idx_audit_events_tenant_id ON public.audit_events(tenant_id);
CREATE INDEX idx_audit_events_user_id ON public.audit_events(user_id);
CREATE INDEX idx_audit_events_action ON public.audit_events(action);
CREATE INDEX idx_tenant_docs_tenant_id ON public.tenant_docs(tenant_id);
CREATE INDEX idx_tenant_chunks_tenant_id ON public.tenant_chunks(tenant_id);
CREATE INDEX idx_agent_memory_scope ON public.agent_memory(scope);
CREATE INDEX idx_agent_memory_tenant_id ON public.agent_memory(tenant_id);

-- 10. Security definer functions to check tenant membership (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _tenant_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(_user_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(tenant_id), '{}')
  FROM public.tenant_users
  WHERE user_id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id UUID, _user_id UUID, _roles tenant_role[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _tenant_id 
      AND user_id = _user_id 
      AND role = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin_or_owner(_tenant_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_tenant_role(_tenant_id, _user_id, ARRAY['owner', 'admin']::tenant_role[])
$$;

-- 11. Enable RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

-- 12. RLS Policies for tenants
CREATE POLICY "Users can view tenants they belong to"
  ON public.tenants FOR SELECT
  USING (public.is_tenant_member(id, auth.uid()));

CREATE POLICY "Owners and admins can update their tenant"
  ON public.tenants FOR UPDATE
  USING (public.is_tenant_admin_or_owner(id, auth.uid()));

-- 13. RLS Policies for tenant_users
CREATE POLICY "Users can view members of their tenants"
  ON public.tenant_users FOR SELECT
  USING (public.is_tenant_member(tenant_id, auth.uid()));

-- NO direct insert policy - must go through accept-invite edge function
CREATE POLICY "Owners and admins can update roles"
  ON public.tenant_users FOR UPDATE
  USING (public.is_tenant_admin_or_owner(tenant_id, auth.uid()));

CREATE POLICY "Owners can delete members"
  ON public.tenant_users FOR DELETE
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner']::tenant_role[]));

-- 14. RLS Policies for tenant_invites
CREATE POLICY "Admins can view invites for their tenant"
  ON public.tenant_invites FOR SELECT
  USING (public.is_tenant_admin_or_owner(tenant_id, auth.uid()));

CREATE POLICY "Admins can create invites for their tenant"
  ON public.tenant_invites FOR INSERT
  WITH CHECK (public.is_tenant_admin_or_owner(tenant_id, auth.uid()));

CREATE POLICY "Admins can delete invites for their tenant"
  ON public.tenant_invites FOR DELETE
  USING (public.is_tenant_admin_or_owner(tenant_id, auth.uid()));

-- 15. RLS Policies for audit_events
CREATE POLICY "Admins can view audit events for their tenant"
  ON public.audit_events FOR SELECT
  USING (
    tenant_id IS NULL AND public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.is_tenant_admin_or_owner(tenant_id, auth.uid())
  );

CREATE POLICY "System can insert audit events"
  ON public.audit_events FOR INSERT
  WITH CHECK (true);

-- 16. RLS Policies for global_docs (readable by all authenticated, writable by super_admin)
CREATE POLICY "Authenticated users can read global docs"
  ON public.global_docs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can manage global docs"
  ON public.global_docs FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- 17. RLS Policies for global_chunks
CREATE POLICY "Authenticated users can read global chunks"
  ON public.global_chunks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can manage global chunks"
  ON public.global_chunks FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- 18. RLS Policies for tenant_docs
CREATE POLICY "Users can view docs for their tenant"
  ON public.tenant_docs FOR SELECT
  USING (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Members can create docs for their tenant"
  ON public.tenant_docs FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Members can update docs for their tenant"
  ON public.tenant_docs FOR UPDATE
  USING (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Admins can delete docs for their tenant"
  ON public.tenant_docs FOR DELETE
  USING (public.is_tenant_admin_or_owner(tenant_id, auth.uid()));

-- 19. RLS Policies for tenant_chunks
CREATE POLICY "Users can view chunks for their tenant"
  ON public.tenant_chunks FOR SELECT
  USING (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Members can create chunks for their tenant"
  ON public.tenant_chunks FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Members can update chunks for their tenant"
  ON public.tenant_chunks FOR UPDATE
  USING (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Admins can delete chunks for their tenant"
  ON public.tenant_chunks FOR DELETE
  USING (public.is_tenant_admin_or_owner(tenant_id, auth.uid()));

-- 20. RLS Policies for agent_memory
CREATE POLICY "Users can read global memory"
  ON public.agent_memory FOR SELECT
  USING (
    scope = 'global' 
    OR (scope = 'tenant' AND public.is_tenant_member(tenant_id, auth.uid()))
  );

CREATE POLICY "Users can create tenant memory for their tenant"
  ON public.agent_memory FOR INSERT
  WITH CHECK (
    (scope = 'global' AND public.has_role(auth.uid(), 'super_admin'::app_role))
    OR (scope = 'tenant' AND public.is_tenant_member(tenant_id, auth.uid()))
  );

CREATE POLICY "Users can update their tenant memory"
  ON public.agent_memory FOR UPDATE
  USING (
    (scope = 'global' AND public.has_role(auth.uid(), 'super_admin'::app_role))
    OR (scope = 'tenant' AND public.is_tenant_member(tenant_id, auth.uid()))
  );

-- 21. Update triggers
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tenant_users_updated_at
  BEFORE UPDATE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_global_docs_updated_at
  BEFORE UPDATE ON public.global_docs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tenant_docs_updated_at
  BEFORE UPDATE ON public.tenant_docs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_agent_memory_updated_at
  BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 22. Create tenant-files storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-files', 'tenant-files', false)
ON CONFLICT (id) DO NOTHING;

-- 23. Storage policies for tenant-files
CREATE POLICY "Users can read their tenant files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'tenant-files' 
    AND public.is_tenant_member(
      (storage.foldername(name))[1]::uuid,
      auth.uid()
    )
  );

CREATE POLICY "Users can upload to their tenant folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'tenant-files' 
    AND public.is_tenant_member(
      (storage.foldername(name))[1]::uuid,
      auth.uid()
    )
  );

CREATE POLICY "Admins can delete tenant files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'tenant-files' 
    AND public.is_tenant_admin_or_owner(
      (storage.foldername(name))[1]::uuid,
      auth.uid()
    )
  );
