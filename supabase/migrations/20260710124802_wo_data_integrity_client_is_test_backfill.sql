-- WO-DATA-INTEGRITY follow-up (2026-07-10): the structural migration
-- (20260710122347) backfilled tenants.is_test by name-pattern but NOT clients.is_test.
-- The watchdog unflaggedTestEntities probe caught the gap. Backfill clients here.
--
-- EXCLUDES legitimate-enumerable fixtures that match the ^_ heuristic but must stay visible
-- (ruled by functional evidence, not name):
--   __platform_security__  : WRAITH security-findings sentinel client (active writer; provisioned
--                            via migration 20260524040000; excluding it hides findings).
--   _invariant_client_a/b  : the tenant-isolation TEST HARNESS. Their fixture users must be able
--                            to see their own client data, or src/test/security/tenant-isolation.
--                            invariant.test.ts fails its positive assertions (active consumer).
-- Idempotent: the genuine dead test client (_dryrun_crt_smoketenant) is already flagged in prod.
update public.clients
  set is_test = true
  where is_test = false
    and name not in ('__platform_security__', '_invariant_client_a', '_invariant_client_b')
    and name ~* '(^_)|legacy|test|_qa|_dryrun|_benchmark|_invariant|smoketest|fixture|sandbox';
