-- Fix document upload RLS for super_admin users
-- Root cause: policies allowed only analyst/admin but Aaron is super_admin

-- STORAGE: archival-documents bucket
DROP POLICY IF EXISTS "Analysts and admins can upload archival files" ON storage.objects;
DROP POLICY IF EXISTS "Analysts and admins can view archival files" ON storage.objects;
DROP POLICY IF EXISTS "Analysts and admins can delete archival files" ON storage.objects;

CREATE POLICY "Analysts, admins, and super admins can upload archival files"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'archival-documents'
  AND (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Analysts, admins, and super admins can view archival files"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'archival-documents'
  AND (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Analysts, admins, and super admins can delete archival files"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'archival-documents'
  AND (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- DB TABLES: allow super_admin to read/manage document rows
DROP POLICY IF EXISTS "Analysts and admins can view archival documents" ON public.archival_documents;
DROP POLICY IF EXISTS "Analysts and admins can manage archival documents" ON public.archival_documents;

CREATE POLICY "Analysts, admins, and super admins can view archival documents"
ON public.archival_documents
FOR SELECT
TO public
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Analysts, admins, and super admins can manage archival documents"
ON public.archival_documents
FOR ALL
TO public
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- ingested_documents
DROP POLICY IF EXISTS "Analysts and admins full access to ingested_documents" ON public.ingested_documents;

CREATE POLICY "Analysts, admins, and super admins full access to ingested_documents"
ON public.ingested_documents
FOR ALL
TO public
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- attachments
DROP POLICY IF EXISTS "Analysts and admins can view attachments" ON public.attachments;
DROP POLICY IF EXISTS "Analysts and admins can manage attachments" ON public.attachments;

CREATE POLICY "Analysts, admins, and super admins can view attachments"
ON public.attachments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Analysts, admins, and super admins can manage attachments"
ON public.attachments
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);
