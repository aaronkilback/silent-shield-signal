-- Fix security warning: Set search_path for calculate_signal_hash function
CREATE OR REPLACE FUNCTION calculate_signal_hash(text_content TEXT)
RETURNS TEXT AS $$
DECLARE
  hash_result TEXT;
BEGIN
  -- Use pgcrypto extension for SHA256 hashing
  hash_result := encode(digest(text_content, 'sha256'), 'hex');
  RETURN hash_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public;