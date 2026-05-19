-- 2026-05-19 — Invariant fixture extension (Phase B).
--
-- Adds one row per tenant on each of:
--   client_assets, site_audits, site_observations
--
-- These are the three tables hardened by
-- 20260519170000_tighten_rls_client_assets_site_audits.sql; this
-- migration completes the fixture set so the tenant-isolation
-- invariant test
-- (src/test/security/tenant-isolation.invariant.test.ts) has stable
-- rows to assert against in both directions (negative + positive).
--
-- Conventions match the Phase A fixtures (migration
-- 20260519160000_invariant_isolation_fixtures.sql):
--   * UUIDs are hand-pinned, prefixed by tenant.
--   * Names are `_invariant_*` so ops queries can filter them out.
--   * Fully idempotent (ON CONFLICT DO NOTHING).
--   * The fixture auth users (invariant_a@…, invariant_b@…) are
--     looked up by email so this migration is reproducible without
--     hard-coding the uuid of an auth.users row.

DO $invariant_phase_b$
DECLARE
  v_user_a_id uuid;
  v_user_b_id uuid;
BEGIN
  SELECT id INTO v_user_a_id
    FROM auth.users
   WHERE email = 'invariant_a@silentshieldsecurity.invariant';
  SELECT id INTO v_user_b_id
    FROM auth.users
   WHERE email = 'invariant_b@silentshieldsecurity.invariant';

  IF v_user_a_id IS NULL OR v_user_b_id IS NULL THEN
    RAISE NOTICE 'Invariant fixture users not yet created; skipping Phase B fixture rows. Run scripts/setup-invariant-users.mjs first.';
    RETURN;
  END IF;

  -- ── client_assets (one per tenant) ────────────────────────────
  -- asset_class / source values must satisfy the CHECK constraints
  -- declared in the original site-audit migration. 'other' / 'manual'
  -- are the safest neutral choices for fixture data.
  INSERT INTO public.client_assets
    (id, client_id, name, asset_class, operational_status, attributes, source, confidence)
  VALUES
    ('11111111-a55e-4a55-aa55-000000000001', '11111111-cccc-4ccc-cccc-000000000001',
     '_invariant_asset_a', 'other', 'active',
     '{"fixture":true,"tenant":"A"}'::jsonb, 'manual', 1.0),
    ('22222222-a55e-4a55-aa55-000000000002', '22222222-cccc-4ccc-cccc-000000000002',
     '_invariant_asset_b', 'other', 'active',
     '{"fixture":true,"tenant":"B"}'::jsonb, 'manual', 1.0)
  ON CONFLICT (id) DO NOTHING;

  -- ── site_audits (one per tenant, primary_operator = fixture user) ──
  -- Status is 'completed' on purpose — observations under in-progress
  -- audits are writable by the operator; completed audits are read-
  -- only, which is the state we want for stable fixture assertions.
  INSERT INTO public.site_audits
    (id, asset_id, client_id, status, started_at, completed_at, primary_operator,
     co_operators, wizard_state, summary_text,
     observations_count, vulnerabilities_added, controls_confirmed)
  VALUES
    ('11111111-a3da-4a3d-aa3d-000000000001', '11111111-a55e-4a55-aa55-000000000001',
     '11111111-cccc-4ccc-cccc-000000000001', 'completed',
     '2026-05-19T00:00:00Z', '2026-05-19T00:01:00Z', v_user_a_id,
     ARRAY[]::uuid[], '{"fixture":true}'::jsonb, '_invariant audit A',
     1, 0, 0),
    ('22222222-a3da-4a3d-aa3d-000000000002', '22222222-a55e-4a55-aa55-000000000002',
     '22222222-cccc-4ccc-cccc-000000000002', 'completed',
     '2026-05-19T00:00:00Z', '2026-05-19T00:01:00Z', v_user_b_id,
     ARRAY[]::uuid[], '{"fixture":true}'::jsonb, '_invariant audit B',
     1, 0, 0)
  ON CONFLICT (id) DO NOTHING;

  -- ── site_observations (one per tenant) ─────────────────────────
  INSERT INTO public.site_observations
    (id, audit_id, asset_id, stage, field_key, value,
     photo_urls, confidence, linked_risk_ids, observer_id, observed_at)
  VALUES
    ('11111111-0b53-40b5-a0b5-000000000001', '11111111-a3da-4a3d-aa3d-000000000001',
     '11111111-a55e-4a55-aa55-000000000001', 'identity', '_invariant',
     '{"fixture":true,"tenant":"A"}'::jsonb,
     ARRAY[]::text[], 1.0, ARRAY[]::uuid[], v_user_a_id, '2026-05-19T00:00:30Z'),
    ('22222222-0b53-40b5-a0b5-000000000002', '22222222-a3da-4a3d-aa3d-000000000002',
     '22222222-a55e-4a55-aa55-000000000002', 'identity', '_invariant',
     '{"fixture":true,"tenant":"B"}'::jsonb,
     ARRAY[]::text[], 1.0, ARRAY[]::uuid[], v_user_b_id, '2026-05-19T00:00:30Z')
  ON CONFLICT (id) DO NOTHING;
END $invariant_phase_b$;
