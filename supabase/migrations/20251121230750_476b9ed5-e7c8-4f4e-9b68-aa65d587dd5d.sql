-- Update RLS policies to allow all authenticated users to manage sources
-- since this is a single-org intelligence system

DROP POLICY IF EXISTS "Analysts and admins full access to sources" ON sources;
DROP POLICY IF EXISTS "Service role full access to sources" ON sources;

-- Allow authenticated users to manage their sources
CREATE POLICY "Authenticated users can manage sources"
ON sources
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Service role can still manage all sources
CREATE POLICY "Service role full access to sources"
ON sources
FOR ALL
USING (true);