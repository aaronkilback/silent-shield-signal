-- Allow authenticated operators to write client_assets.
-- Phase 2A left this as read-only for authenticated; the audit wizard
-- needs to insert new assets ("Add new site" in AssetPicker) and
-- update them via writeback RPCs. Matches the spirit of the Phase 2A
-- comment ("authenticated users can read all rows so the wizard
-- works") — extended to write so the wizard can actually create.
--
-- Per-client-membership scoping is deferred to a follow-up migration
-- that ties this to the operator/client membership model.

BEGIN;

CREATE POLICY "client_assets_write_auth" ON public.client_assets
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
