-- P1: ai_assistant_messages tenant/user isolation fix + policy dedup + UPDATE with_check hardening.
--
-- Closes a cross-user/cross-tenant read exposure: the PERMISSIVE SELECT policy
-- `auth_users_can_view_ai_messages` (qual: auth.uid() IS NOT NULL) made every row
-- readable by ANY authenticated user (PERMISSIVE policies OR together), nullifying
-- the intended per-user and per-tenant-shared policies. Proven on prod: a non-super-
-- admin could read 653/653 rows (566 foreign) instead of their own 87.
--
-- This migration drops the over-broad policy, collapses the duplicate policies to one
-- canonical policy per command, retains the explicit super_admin bypass, and hardens
-- UPDATE with WITH CHECK (prevents reassigning user_id off own rows).
--
-- Validated on staging (lkvyrvuakzguszbpwnfz) then applied to prod (kpuqukppbmwebiptqmog)
-- via MCP apply_migration on 2026-05-25; this file mirrors that applied SQL (version
-- 20260525011255) so repo and DB match. Post-apply non-super-admin read: 87 rows, 0 foreign.
--
-- Post-state canonical policies (5):
--   SELECT "Users can view own or shared tenant messages"
--   INSERT "Users can create own messages"        WITH CHECK (user_id = auth.uid())
--   UPDATE "Users can update own messages"         USING + WITH CHECK (user_id = auth.uid())
--   DELETE "Users can delete own messages"
--   ALL    "super_admin_bypass_ai_messages"        is_super_admin(auth.uid())

DROP POLICY IF EXISTS "auth_users_can_view_ai_messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can view their own AI messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can view their own messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can insert their own AI messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can insert their own messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can update their own AI messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can delete their own AI messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.ai_assistant_messages;
DROP POLICY IF EXISTS "Users can update own messages" ON public.ai_assistant_messages;
CREATE POLICY "Users can update own messages" ON public.ai_assistant_messages
  FOR UPDATE TO public
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
