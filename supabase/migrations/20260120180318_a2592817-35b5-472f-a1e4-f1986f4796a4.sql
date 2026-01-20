
-- Fix RLS policy to allow super_admin to view all tenant activity
DROP POLICY IF EXISTS "Users can view tenant activity" ON tenant_activity;

CREATE POLICY "Users can view tenant activity"
ON tenant_activity
FOR SELECT
USING (
  is_super_admin(auth.uid()) 
  OR tenant_id IN (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
  )
);
