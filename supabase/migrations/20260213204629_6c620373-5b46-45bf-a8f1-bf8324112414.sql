
-- Fix: Allow authenticated users to read investigation_communications where tenant_id is null
-- This is needed because the edge functions insert with tenant_id = null
DROP POLICY IF EXISTS "Admins and analysts can view tenant comms" ON investigation_communications;

CREATE POLICY "Authenticated users can view comms"
  ON investigation_communications
  FOR SELECT
  USING (
    is_super_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'analyst'::app_role)
    OR investigator_user_id = auth.uid()
  );

-- Also fix INSERT policy to allow edge-function-inserted rows with system placeholder UUID
DROP POLICY IF EXISTS "Analysts can send messages" ON investigation_communications;

CREATE POLICY "Authenticated users can insert comms"
  ON investigation_communications
  FOR INSERT
  WITH CHECK (
    is_super_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'analyst'::app_role)
    OR investigator_user_id = auth.uid()
  );
