-- ════════════════════════════════════════════════════════════════════════════
-- #256 Phase 4 (2026-05-23) — provision __platform_security__ sentinel client.
--
-- BACKGROUND
--   wraith-security-advisor previously attributed all platform-internal
--   Fortress vulnerability findings to the first active client returned by
--   `from('clients').select('id').eq('status','active').limit(1)`. That
--   was arbitrary cross-tenant attribution: whichever customer happened to
--   be returned first received operator-internal alerts in their analyst
--   feed. Per #256 doctrine: explicit ownership or skip; never an arbitrary
--   first-row pick.
--
-- RESOLUTION (Aaron-approved Option 1, 2026-05-23)
--   Provision a dedicated sentinel client `__platform_security__` inside
--   the `Silent Shield Operations` tenant. wraith-security-advisor will
--   resolve this client by invariant (tenant_name + client_name) at
--   runtime and write platform-security signals there. If the sentinel
--   is not found (e.g., on staging where the SSO tenant does not exist),
--   wraith logs an error and SKIPS emission — no fallback.
--
-- INVARIANT
--   Lookup key: (tenant.name = 'Silent Shield Operations'
--                AND client.name = '__platform_security__'
--                AND client.status = 'active')
--   This is the contract wraith depends on. Renaming either name on
--   prod will silently break wraith signal emission until the lookup
--   is updated — be deliberate.
--
-- IDEMPOTENCY
--   ON CONFLICT DO NOTHING keyed on (tenant_id, name) — re-running this
--   migration on a tenant that already has the sentinel is a no-op.
--   If the SSO tenant doesn't exist (e.g., on staging), the WHERE clause
--   matches zero rows and the INSERT is a no-op with NOTICE — safe.
--
-- FUTURE
--   Track later: introduce a `client.role` / `client.classification`
--   column to mark sentinel/system clients separately from customer
--   clients so dashboards can hide them from customer-facing selectors.
--   Not in scope for this migration.
--
-- ROLLBACK (manual SQL)
--   DELETE FROM clients
--   WHERE name = '__platform_security__'
--     AND tenant_id IN (SELECT id FROM tenants WHERE name = 'Silent Shield Operations');
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tenant_id uuid;
  v_existing_count int;
  v_inserted boolean := false;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE name = 'Silent Shield Operations';
  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '#256 Phase 4: Silent Shield Operations tenant not present in this environment — skipping sentinel client provisioning. wraith-security-advisor will fail-skip until this tenant exists.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM clients
  WHERE tenant_id = v_tenant_id AND name = '__platform_security__';

  IF v_existing_count > 0 THEN
    -- Ensure status is active even if it pre-existed in another state.
    UPDATE clients
    SET status = 'active',
        organization = COALESCE(organization, 'Silent Shield Operations'),
        industry = COALESCE(industry, 'platform_security'),
        updated_at = NOW()
    WHERE tenant_id = v_tenant_id AND name = '__platform_security__';
    RAISE NOTICE '#256 Phase 4: __platform_security__ already exists in Silent Shield Operations (tenant=%); ensured status=active', v_tenant_id;
  ELSE
    INSERT INTO clients (
      tenant_id, name, organization, industry, status,
      monitoring_keywords, tech_stack, locations, high_value_assets
    ) VALUES (
      v_tenant_id,
      '__platform_security__',
      'Silent Shield Operations',
      'platform_security',
      'active',
      ARRAY[]::text[],
      ARRAY[]::text[],
      ARRAY[]::text[],
      ARRAY[]::text[]
    );
    v_inserted := true;
    RAISE NOTICE '#256 Phase 4: provisioned __platform_security__ in Silent Shield Operations (tenant=%)', v_tenant_id;
  END IF;
END $$;

-- Final visibility check: confirm the sentinel exists where expected (or absent on non-prod).
DO $$
DECLARE v_sentinel_id uuid;
BEGIN
  SELECT c.id INTO v_sentinel_id
  FROM clients c
  JOIN tenants t ON c.tenant_id = t.id
  WHERE t.name = 'Silent Shield Operations'
    AND c.name = '__platform_security__'
    AND c.status = 'active';
  IF v_sentinel_id IS NULL THEN
    RAISE NOTICE '#256 Phase 4 verification: __platform_security__ NOT FOUND. Expected on prod; absent on staging is OK.';
  ELSE
    RAISE NOTICE '#256 Phase 4 verification: __platform_security__ resolved to client_id=%', v_sentinel_id;
  END IF;
END $$;
