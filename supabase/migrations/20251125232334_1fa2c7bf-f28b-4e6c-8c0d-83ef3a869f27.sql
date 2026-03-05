-- Backfill content_hash for existing signals and remove duplicates

-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- First, create a function to calculate SHA256 hash
CREATE OR REPLACE FUNCTION calculate_signal_hash(text_content TEXT)
RETURNS TEXT AS $$
DECLARE
  hash_result TEXT;
BEGIN
  -- Use pgcrypto extension for SHA256 hashing
  hash_result := encode(extensions.digest(text_content, 'sha256'), 'hex');
  RETURN hash_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update all signals that don't have a content_hash
UPDATE signals
SET content_hash = calculate_signal_hash(normalized_text)
WHERE content_hash IS NULL AND normalized_text IS NOT NULL;

-- Create a temporary table to identify duplicates (keeping the oldest)
CREATE TEMP TABLE signals_to_keep AS
SELECT DISTINCT ON (content_hash) id
FROM signals
WHERE content_hash IS NOT NULL
ORDER BY content_hash, created_at ASC;

-- Delete duplicate signals (keep only the oldest one per hash)
DELETE FROM signals
WHERE content_hash IS NOT NULL 
  AND id NOT IN (SELECT id FROM signals_to_keep);

-- Drop the temporary table
DROP TABLE signals_to_keep;