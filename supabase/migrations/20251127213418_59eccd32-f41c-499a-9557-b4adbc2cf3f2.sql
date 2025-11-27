-- Add client_id to travelers and itineraries tables
ALTER TABLE travelers ADD COLUMN client_id UUID REFERENCES clients(id);
ALTER TABLE itineraries ADD COLUMN client_id UUID REFERENCES clients(id);

-- Create index for performance
CREATE INDEX idx_travelers_client_id ON travelers(client_id);
CREATE INDEX idx_itineraries_client_id ON itineraries(client_id);

-- Drop existing overly permissive RLS policies
DROP POLICY IF EXISTS "Analysts and admins can manage investigations" ON investigations;
DROP POLICY IF EXISTS "Analysts and admins can view investigations" ON investigations;
DROP POLICY IF EXISTS "Analysts and admins can manage travelers" ON travelers;
DROP POLICY IF EXISTS "Analysts and admins can view travelers" ON travelers;
DROP POLICY IF EXISTS "Analysts and admins can manage itineraries" ON itineraries;
DROP POLICY IF EXISTS "Analysts and admins can view itineraries" ON itineraries;

-- Create client-isolated RLS policies for investigations
CREATE POLICY "Users can view investigations for their client"
ON investigations FOR SELECT
USING (
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    client_id IN (
      SELECT id FROM clients 
      WHERE id::text = current_setting('app.current_client_id', true)
    )
    OR current_setting('app.current_client_id', true) IS NULL
    OR current_setting('app.current_client_id', true) = ''
  )
);

CREATE POLICY "Users can manage investigations for their client"
ON investigations FOR ALL
USING (
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    client_id IN (
      SELECT id FROM clients 
      WHERE id::text = current_setting('app.current_client_id', true)
    )
    OR current_setting('app.current_client_id', true) IS NULL
    OR current_setting('app.current_client_id', true) = ''
  )
);

-- Create client-isolated RLS policies for travelers
CREATE POLICY "Users can view travelers for their client"
ON travelers FOR SELECT
USING (
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    client_id IN (
      SELECT id FROM clients 
      WHERE id::text = current_setting('app.current_client_id', true)
    )
    OR current_setting('app.current_client_id', true) IS NULL
    OR current_setting('app.current_client_id', true) = ''
  )
);

CREATE POLICY "Users can manage travelers for their client"
ON travelers FOR ALL
USING (
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    client_id IN (
      SELECT id FROM clients 
      WHERE id::text = current_setting('app.current_client_id', true)
    )
    OR current_setting('app.current_client_id', true) IS NULL
    OR current_setting('app.current_client_id', true) = ''
  )
);

-- Create client-isolated RLS policies for itineraries
CREATE POLICY "Users can view itineraries for their client"
ON itineraries FOR SELECT
USING (
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    client_id IN (
      SELECT id FROM clients 
      WHERE id::text = current_setting('app.current_client_id', true)
    )
    OR current_setting('app.current_client_id', true) IS NULL
    OR current_setting('app.current_client_id', true) = ''
  )
);

CREATE POLICY "Users can manage itineraries for their client"
ON itineraries FOR ALL
USING (
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    client_id IN (
      SELECT id FROM clients 
      WHERE id::text = current_setting('app.current_client_id', true)
    )
    OR current_setting('app.current_client_id', true) IS NULL
    OR current_setting('app.current_client_id', true) = ''
  )
);