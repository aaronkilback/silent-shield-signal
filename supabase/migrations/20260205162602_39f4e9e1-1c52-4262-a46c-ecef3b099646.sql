-- Backfill orphaned travel security reports with ownership based on the storage object's owner
-- This restores report visibility under existing RLS policies (uploaded_by = auth.uid()).

UPDATE public.archival_documents ad
SET uploaded_by = so.owner,
    metadata = COALESCE(ad.metadata, '{}'::jsonb) || jsonb_build_object('uploaded_by', so.owner)
FROM storage.objects so
WHERE so.bucket_id = 'travel-documents'
  AND so.name = ad.storage_path
  AND ad.uploaded_by IS NULL
  AND ad.tags @> ARRAY['travel-security'::text]
  AND so.owner IS NOT NULL;
