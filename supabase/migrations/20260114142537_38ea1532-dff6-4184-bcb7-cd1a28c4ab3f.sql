-- Fix AI_AGENTS: Restrict to authenticated users with roles
DROP POLICY IF EXISTS "Anyone can view active agents" ON public.ai_agents;
DROP POLICY IF EXISTS "Authenticated users can view agents" ON public.ai_agents;

CREATE POLICY "Admins and analysts can view AI agents"
ON public.ai_agents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

-- Fix KNOWLEDGE_BASE_ARTICLES: Require authentication
DROP POLICY IF EXISTS "Anyone can view published articles" ON public.knowledge_base_articles;
DROP POLICY IF EXISTS "Service role manages knowledge base articles" ON public.knowledge_base_articles;

CREATE POLICY "Authenticated users can view knowledge base articles"
ON public.knowledge_base_articles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role manages kb articles"
ON public.knowledge_base_articles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);