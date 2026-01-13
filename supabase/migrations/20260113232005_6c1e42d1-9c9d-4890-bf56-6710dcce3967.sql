-- Fix storage policies for entity-photos bucket
-- Drop existing policies
DROP POLICY IF EXISTS "Analysts and admins can upload entity photos" ON storage.objects;
DROP POLICY IF EXISTS "Analysts and admins can view entity photos" ON storage.objects;
DROP POLICY IF EXISTS "Analysts and admins can delete entity photos" ON storage.objects;

-- Create new policies that include super_admin and have proper WITH CHECK for uploads
CREATE POLICY "Users with roles can upload entity photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'entity-photos' AND (
    has_role(auth.uid(), 'analyst'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Users with roles can view entity photos"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'entity-photos' AND (
    has_role(auth.uid(), 'analyst'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Users with roles can delete entity photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'entity-photos' AND (
    has_role(auth.uid(), 'analyst'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Users with roles can update entity photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'entity-photos' AND (
    has_role(auth.uid(), 'analyst'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);