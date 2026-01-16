-- Create workspace invitations table
CREATE TABLE public.workspace_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'contributor',
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  invited_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending'
);

-- Enable RLS
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Workspace owners can create invitations"
ON public.workspace_invitations
FOR INSERT
WITH CHECK (is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can view invitations"
ON public.workspace_invitations
FOR SELECT
USING (is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can delete invitations"
ON public.workspace_invitations
FOR DELETE
USING (is_workspace_owner(workspace_id, auth.uid()));

-- Allow public access to accept invitation by token (for signup flow)
CREATE POLICY "Anyone can view invitation by token"
ON public.workspace_invitations
FOR SELECT
USING (true);

-- Add index for token lookup
CREATE INDEX idx_workspace_invitations_token ON public.workspace_invitations(token);
CREATE INDEX idx_workspace_invitations_email ON public.workspace_invitations(email);