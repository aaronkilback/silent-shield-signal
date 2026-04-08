-- =============================================================================
-- WRAITH: codebase_snapshots table
-- Stores edge function source code for AI vulnerability scanning.
-- Populated by a cron job that reads function files and upserts snapshots.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.codebase_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path     TEXT NOT NULL UNIQUE,
  source_code   TEXT NOT NULL,
  file_size     INTEGER,
  sha256        TEXT,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_codebase_snapshots_file_path ON public.codebase_snapshots(file_path);
CREATE INDEX idx_codebase_snapshots_updated   ON public.codebase_snapshots(updated_at DESC);

ALTER TABLE public.codebase_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_codebase_snapshots"
  ON public.codebase_snapshots FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Authenticated users can read snapshots (analysts reviewing vulnerability scan targets)
CREATE POLICY "authenticated_read_codebase_snapshots"
  ON public.codebase_snapshots FOR SELECT
  USING (auth.uid() IS NOT NULL);
