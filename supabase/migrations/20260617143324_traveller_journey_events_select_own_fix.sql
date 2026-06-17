-- Correct the traveller SELECT policy on traveller_journey_events.
-- The original policy depended on a travelers-RLS-gated EXISTS subquery, which a tenant-less
-- traveller cannot satisfy via direct PostgREST, so own-select returned 0 rows. created_by is
-- set to auth.uid() at insert (and the INSERT policy already enforced traveler linkage), so
-- created_by = auth.uid() is a sufficient and correct ownership predicate.
DROP POLICY IF EXISTS tje_traveller_select_own ON public.traveller_journey_events;
CREATE POLICY tje_traveller_select_own ON public.traveller_journey_events
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());
