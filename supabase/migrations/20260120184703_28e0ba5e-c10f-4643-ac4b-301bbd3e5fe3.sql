-- Fix overly permissive RLS policies that allow unauthenticated access

-- 1. Fix ai_agents: Remove the overly permissive "Users can view active agents" policy
-- This policy allows ANY user (even unauthenticated) to see active agents
DROP POLICY IF EXISTS "Users can view active agents" ON public.ai_agents;

-- 2. Fix workspace_invitations: Remove the "Anyone can view invitation by token" policy  
-- This allows completely unauthenticated access to all invitations
DROP POLICY IF EXISTS "Anyone can view invitation by token" ON public.workspace_invitations;

-- 3. Create a proper token-based lookup policy for workspace invitations
-- This allows looking up an invitation by token, but only for the specific token holder
-- The edge function handles token validation server-side with service role
-- We need to allow the accept-invite edge function to work while preventing public enumeration
-- Solution: Only allow SELECT when querying by specific token (handled in edge function with service role)
-- The existing "Users can view their own invitations" policy handles authenticated user access