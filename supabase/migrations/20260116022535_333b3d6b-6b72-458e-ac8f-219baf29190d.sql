-- Create MCM (Major Case Management) workspace role enum
CREATE TYPE public.workspace_mcm_role AS ENUM (
  'team_commander',      -- Strategic oversight, approvals, case closure
  'primary_investigator', -- Day-to-day tactical lead, assignments
  'file_coordinator',     -- Evidence/document management, quality control
  'investigator',         -- Line staff, submit findings
  'analyst',              -- Support, analysis notes
  'viewer'                -- Read-only stakeholder
);

-- Add MCM role column to workspace_members (nullable initially for migration)
ALTER TABLE public.workspace_members 
ADD COLUMN mcm_role workspace_mcm_role DEFAULT 'investigator';

-- Migrate existing roles to MCM roles
UPDATE public.workspace_members 
SET mcm_role = CASE 
  WHEN role = 'owner' THEN 'team_commander'::workspace_mcm_role
  WHEN role = 'contributor' THEN 'investigator'::workspace_mcm_role
  WHEN role = 'viewer' THEN 'viewer'::workspace_mcm_role
  ELSE 'investigator'::workspace_mcm_role
END;

-- Add MCM role to workspace_invitations as well
ALTER TABLE public.workspace_invitations 
ADD COLUMN mcm_role workspace_mcm_role DEFAULT 'investigator';

-- Create a helper function to check MCM role permissions
CREATE OR REPLACE FUNCTION public.has_mcm_permission(
  _workspace_id uuid, 
  _user_id uuid, 
  _required_roles workspace_mcm_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id 
      AND user_id = _user_id 
      AND mcm_role = ANY(_required_roles)
  )
$$;

-- Create convenience functions for common permission checks
CREATE OR REPLACE FUNCTION public.can_approve_actions(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_mcm_permission(
    _workspace_id, 
    _user_id, 
    ARRAY['team_commander']::workspace_mcm_role[]
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_assignments(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_mcm_permission(
    _workspace_id, 
    _user_id, 
    ARRAY['team_commander', 'primary_investigator']::workspace_mcm_role[]
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_evidence(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_mcm_permission(
    _workspace_id, 
    _user_id, 
    ARRAY['team_commander', 'primary_investigator', 'file_coordinator']::workspace_mcm_role[]
  )
$$;

CREATE OR REPLACE FUNCTION public.can_submit_findings(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_mcm_permission(
    _workspace_id, 
    _user_id, 
    ARRAY['team_commander', 'primary_investigator', 'file_coordinator', 'investigator']::workspace_mcm_role[]
  )
$$;

CREATE OR REPLACE FUNCTION public.can_add_analysis(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_mcm_permission(
    _workspace_id, 
    _user_id, 
    ARRAY['team_commander', 'primary_investigator', 'file_coordinator', 'investigator', 'analyst']::workspace_mcm_role[]
  )
$$;

-- Add comment for documentation
COMMENT ON TYPE public.workspace_mcm_role IS 'Major Case Management roles based on Command Triangle methodology: Team Commander (strategic), Primary Investigator (tactical), File Coordinator (evidence), Investigator (line staff), Analyst (support), Viewer (read-only)';