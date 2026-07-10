-- WO-DATA-INTEGRITY follow-up (2026-07-10): the structural migration
-- (20260710122347) backfilled tenants.is_test by name-pattern but NOT clients.is_test.
-- The watchdog unflaggedTestEntities probe caught the gap. Backfill clients here.
--
-- EXCLUDES __platform_security__: it matches the ^_ heuristic but is real internal ops —
-- the WRAITH security-findings sentinel client (active writer; provisioned via migration
-- 20260524040000). Confirmed by functional evidence (active writer + hides findings if
-- excluded), not by name. Idempotent: the 3 genuine test clients are already flagged in prod.
update public.clients
  set is_test = true
  where is_test = false
    and name <> '__platform_security__'
    and name ~* '(^_)|legacy|test|_qa|_dryrun|_benchmark|_invariant|smoketest|fixture|sandbox';
