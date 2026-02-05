-- Fix travel documents storage policies to include super_admin role

-- Drop existing travel document policies
DROP POLICY IF EXISTS "Analysts and admins can upload travel documents" ON storage.objects;
DROP POLICY IF EXISTS "Analysts and admins can view travel documents" ON storage.objects;
DROP POLICY IF EXISTS "Analysts and admins can delete travel documents" ON storage.objects;

-- Recreate with super_admin included
CREATE POLICY "Users with roles can upload travel documents" 
ON storage.objects FOR INSERT 
WITH CHECK (
  bucket_id = 'travel-documents' AND (
    has_role(auth.uid(), 'analyst') OR 
    has_role(auth.uid(), 'admin') OR 
    has_role(auth.uid(), 'super_admin')
  )
);

CREATE POLICY "Users with roles can view travel documents" 
ON storage.objects FOR SELECT 
USING (
  bucket_id = 'travel-documents' AND (
    has_role(auth.uid(), 'analyst') OR 
    has_role(auth.uid(), 'admin') OR 
    has_role(auth.uid(), 'super_admin')
  )
);

CREATE POLICY "Users with roles can delete travel documents" 
ON storage.objects FOR DELETE 
USING (
  bucket_id = 'travel-documents' AND (
    has_role(auth.uid(), 'analyst') OR 
    has_role(auth.uid(), 'admin') OR 
    has_role(auth.uid(), 'super_admin')
  )
);