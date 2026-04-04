-- Prevent duplicate ingested_documents for the same source URL.
-- Multiple concurrent monitoring runs can race to insert the same URL;
-- this unique index makes the insert idempotent (ON CONFLICT DO NOTHING).
-- Partial index: only applies where source_url is non-null (documents
-- without a source URL are excluded and remain unrestricted).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_documents_source_url_unique
  ON ingested_documents (source_url)
  WHERE source_url IS NOT NULL AND source_url <> '';
