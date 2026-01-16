-- Add system_role column to workspace_invitations
ALTER TABLE public.workspace_invitations
ADD COLUMN system_role app_role NOT NULL DEFAULT 'viewer';

-- Add comment for clarity
COMMENT ON COLUMN public.workspace_invitations.system_role IS 'The app-wide role assigned to the user upon signup (viewer, analyst, admin)';