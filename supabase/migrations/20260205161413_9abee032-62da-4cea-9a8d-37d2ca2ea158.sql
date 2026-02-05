-- Allow uploaders to manage (and view) ONLY their own travel-security reports

CREATE POLICY "Users can view own travel security reports"
ON public.archival_documents
FOR SELECT
TO authenticated
USING (
  uploaded_by = auth.uid()
  AND tags @> ARRAY['travel-security']::text[]
);

CREATE POLICY "Users can insert own travel security reports"
ON public.archival_documents
FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND tags @> ARRAY['travel-security']::text[]
);

CREATE POLICY "Users can update own travel security reports"
ON public.archival_documents
FOR UPDATE
TO authenticated
USING (
  uploaded_by = auth.uid()
  AND tags @> ARRAY['travel-security']::text[]
)
WITH CHECK (
  uploaded_by = auth.uid()
  AND tags @> ARRAY['travel-security']::text[]
);

CREATE POLICY "Users can delete own travel security reports"
ON public.archival_documents
FOR DELETE
TO authenticated
USING (
  uploaded_by = auth.uid()
  AND tags @> ARRAY['travel-security']::text[]
);

-- Helpful index for per-user travel security lookups
CREATE INDEX IF NOT EXISTS idx_archival_documents_uploaded_by_created_at
ON public.archival_documents (uploaded_by, created_at DESC);
