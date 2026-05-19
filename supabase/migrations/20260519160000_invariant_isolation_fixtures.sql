-- 2026-05-19 — Dedicated SELECT-only fixture data for the tenant
-- isolation invariant test (src/test/security/tenant-isolation.invariant.test.ts).
--
-- INVARIANT: A user scoped to tenant A must never retrieve a row that
-- belongs to tenant B from signals / clients / entities / incidents /
-- investigations / reports. RLS is the enforcement layer; this fixture
-- + the vitest test prove the layer continues to hold.
--
-- Conventions:
--   * UUIDs are hand-pinned and prefixed by tenant (1… for A, 2… for B)
--     so test references stay stable across DB recreates.
--   * Names start with `_invariant_` to mark as fixture (filterable
--     for ops queries, and excluded from name-based monitoring logic).
--   * No monitoring_keywords, no active_monitoring_enabled entities,
--     no tags that would make any monitor function produce signals
--     for these clients.
--   * Fully idempotent (ON CONFLICT DO NOTHING) — safe to re-apply.
--
-- Companion: scripts/setup-invariant-users.mjs creates the two auth
-- users that complete this fixture and become the test's principals.

-- ── TENANTS ──────────────────────────────────────────────────────
INSERT INTO public.tenants (id, name, status, settings) VALUES
  ('11111111-aaaa-4aaa-aaaa-000000000001', '_invariant_tenant_a', 'active', '{"ui_profile":"operator"}'::jsonb),
  ('22222222-bbbb-4bbb-bbbb-000000000002', '_invariant_tenant_b', 'active', '{"ui_profile":"operator"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── CLIENTS (one per tenant) ─────────────────────────────────────
INSERT INTO public.clients (id, name, tenant_id, status, organization) VALUES
  ('11111111-cccc-4ccc-cccc-000000000001', '_invariant_client_a', '11111111-aaaa-4aaa-aaaa-000000000001', 'active', '_invariant'),
  ('22222222-cccc-4ccc-cccc-000000000002', '_invariant_client_b', '22222222-bbbb-4bbb-bbbb-000000000002', 'active', '_invariant')
ON CONFLICT (id) DO NOTHING;

-- ── SIGNALS (one per tenant) ─────────────────────────────────────
INSERT INTO public.signals (id, signal_number, tenant_id, client_id, normalized_text, severity, category, status) VALUES
  ('11111111-5519-4519-5519-000000000001', 'INV-A-001', '11111111-aaaa-4aaa-aaaa-000000000001', '11111111-cccc-4ccc-cccc-000000000001', 'invariant fixture signal A', 'low', 'fixture', 'archived'),
  ('22222222-5519-4519-5519-000000000002', 'INV-B-001', '22222222-bbbb-4bbb-bbbb-000000000002', '22222222-cccc-4ccc-cccc-000000000002', 'invariant fixture signal B', 'low', 'fixture', 'archived')
ON CONFLICT (id) DO NOTHING;

-- ── ENTITIES (one per tenant) ────────────────────────────────────
INSERT INTO public.entities (id, name, type, tenant_id, client_id, risk_level) VALUES
  ('11111111-e519-4519-e519-000000000001', '_invariant_entity_a', 'other', '11111111-aaaa-4aaa-aaaa-000000000001', '11111111-cccc-4ccc-cccc-000000000001', 'low'),
  ('22222222-e519-4519-e519-000000000002', '_invariant_entity_b', 'other', '22222222-bbbb-4bbb-bbbb-000000000002', '22222222-cccc-4ccc-cccc-000000000002', 'low')
ON CONFLICT (id) DO NOTHING;

-- ── INCIDENTS (one per tenant) ───────────────────────────────────
INSERT INTO public.incidents (id, tenant_id, client_id, title, summary, status, priority) VALUES
  ('11111111-1519-4519-1519-000000000001', '11111111-aaaa-4aaa-aaaa-000000000001', '11111111-cccc-4ccc-cccc-000000000001', '_invariant_incident_a', 'fixture for isolation test', 'closed', 'p4'),
  ('22222222-1519-4519-1519-000000000002', '22222222-bbbb-4bbb-bbbb-000000000002', '22222222-cccc-4ccc-cccc-000000000002', '_invariant_incident_b', 'fixture for isolation test', 'closed', 'p4')
ON CONFLICT (id) DO NOTHING;

-- ── INVESTIGATIONS (investigations has no tenant_id column, only client_id) ──
INSERT INTO public.investigations (id, file_number, client_id, synopsis, created_by_name) VALUES
  ('11111111-9519-4519-9519-000000000001', 'INV-A-FILE-001', '11111111-cccc-4ccc-cccc-000000000001', '_invariant fixture investigation A', '_invariant_seed'),
  ('22222222-9519-4519-9519-000000000002', 'INV-B-FILE-002', '22222222-cccc-4ccc-cccc-000000000002', '_invariant fixture investigation B', '_invariant_seed')
ON CONFLICT (id) DO NOTHING;

-- ── REPORTS (one per tenant) ─────────────────────────────────────
INSERT INTO public.reports (id, type, period_start, period_end, tenant_id, client_id, meta_json) VALUES
  ('11111111-7519-4519-7519-000000000001', 'invariant_fixture', '2026-05-19T00:00:00Z', '2026-05-19T23:59:59Z', '11111111-aaaa-4aaa-aaaa-000000000001', '11111111-cccc-4ccc-cccc-000000000001', '{"fixture":true,"tenant":"A"}'::jsonb),
  ('22222222-7519-4519-7519-000000000002', 'invariant_fixture', '2026-05-19T00:00:00Z', '2026-05-19T23:59:59Z', '22222222-bbbb-4bbb-bbbb-000000000002', '22222222-cccc-4ccc-cccc-000000000002', '{"fixture":true,"tenant":"B"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
