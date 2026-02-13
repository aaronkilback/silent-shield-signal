
-- Fix 1: Restrict autonomous_scan_results to admin/super_admin only
DROP POLICY IF EXISTS "Authenticated read" ON public.autonomous_scan_results;
CREATE POLICY "Admins can view scan results"
ON public.autonomous_scan_results
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.is_super_admin(auth.uid())
);

-- Fix 2: Tighten universal_learning_log to admin/super_admin only
DROP POLICY IF EXISTS "Authenticated users can view learning logs" ON public.universal_learning_log;
CREATE POLICY "Admins can view learning logs"
ON public.universal_learning_log
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.is_super_admin(auth.uid())
);

-- Fix 3: Make sensitive storage buckets private
UPDATE storage.buckets SET public = false WHERE id = 'entity-photos';
UPDATE storage.buckets SET public = false WHERE id = 'travel-documents';
UPDATE storage.buckets SET public = false WHERE id = 'bug-screenshots';
UPDATE storage.buckets SET public = false WHERE id = 'osint-media';
-- agent-avatars stays public (low risk, avatar images only)

-- Fix 3b: Add authenticated SELECT policies for the now-private buckets
CREATE POLICY "Authenticated users can view entity photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'entity-photos');

CREATE POLICY "Authenticated users can view travel documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'travel-documents');

CREATE POLICY "Authenticated users can view bug screenshots"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bug-screenshots');

CREATE POLICY "Authenticated users can view osint media"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'osint-media');
