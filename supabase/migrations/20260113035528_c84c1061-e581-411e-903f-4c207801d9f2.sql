-- Allow newly authenticated users to see data by self-assigning the minimal 'viewer' role
-- This prevents a "blank app" experience where users have no roles and cannot see Signals/Clients.

CREATE POLICY "Users can self-assign viewer role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'viewer'::app_role
);
