-- Make travel-documents bucket public for AI to read files
UPDATE storage.buckets 
SET public = true 
WHERE id = 'travel-documents';