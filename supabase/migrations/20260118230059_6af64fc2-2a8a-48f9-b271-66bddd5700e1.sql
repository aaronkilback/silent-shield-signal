-- Create tenant knowledge table for cross-user context sharing
CREATE TABLE public.tenant_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  knowledge_type TEXT NOT NULL DEFAULT 'context', -- 'context', 'instruction', 'user_note', 'preference'
  subject TEXT, -- e.g., 'Mark Healey', 'Ember Leaf', 'General'
  content TEXT NOT NULL,
  importance_score INTEGER DEFAULT 5, -- 1-10, higher = more important
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tenant_knowledge ENABLE ROW LEVEL SECURITY;

-- Policies: Only admins/owners can manage, all tenant members can read
CREATE POLICY "Tenant members can view knowledge"
ON public.tenant_knowledge
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = tenant_knowledge.tenant_id
    AND tu.user_id = auth.uid()
  )
);

CREATE POLICY "Tenant admins can insert knowledge"
ON public.tenant_knowledge
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = tenant_knowledge.tenant_id
    AND tu.user_id = auth.uid()
    AND tu.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Tenant admins can update knowledge"
ON public.tenant_knowledge
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = tenant_knowledge.tenant_id
    AND tu.user_id = auth.uid()
    AND tu.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Tenant admins can delete knowledge"
ON public.tenant_knowledge
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = tenant_knowledge.tenant_id
    AND tu.user_id = auth.uid()
    AND tu.role IN ('owner', 'admin')
  )
);

-- Index for efficient queries
CREATE INDEX idx_tenant_knowledge_tenant_active ON public.tenant_knowledge(tenant_id, is_active) WHERE is_active = true;
CREATE INDEX idx_tenant_knowledge_subject ON public.tenant_knowledge(subject) WHERE subject IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_tenant_knowledge_updated_at
BEFORE UPDATE ON public.tenant_knowledge
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();