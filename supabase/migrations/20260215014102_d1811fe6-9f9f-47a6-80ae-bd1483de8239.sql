-- Fix storage SELECT RLS policies to require authentication

-- Drop overly permissive SELECT policies (missing auth check)
DROP POLICY IF EXISTS "Authenticated users can view bug screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view entity photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view osint media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view travel documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view snapshots" ON storage.objects;

-- Recreate with proper auth checks
CREATE POLICY "Authenticated users can view bug screenshots" ON storage.objects
FOR SELECT USING (bucket_id = 'bug-screenshots' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view entity photos" ON storage.objects
FOR SELECT USING (bucket_id = 'entity-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view osint media" ON storage.objects
FOR SELECT USING (bucket_id = 'osint-media' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view travel documents" ON storage.objects
FOR SELECT USING (bucket_id = 'travel-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view snapshots" ON storage.objects
FOR SELECT USING (bucket_id = 'source-snapshots' AND auth.role() = 'authenticated');