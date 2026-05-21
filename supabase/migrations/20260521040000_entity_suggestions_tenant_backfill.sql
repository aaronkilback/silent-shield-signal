-- ════════════════════════════════════════════════════════════════════════════
-- #134 — Backfill tenant_id on existing entity_suggestions
--
-- Defect: nine writer functions inserted entity_suggestions rows without
-- setting tenant_id. RLS for analysts/admins requires tenant_id NOT NULL,
-- so these rows were invisible to non-super-admin users.
--
-- All nine writers are now patched (commit alongside this migration).
-- This migration backfills historical NULL-tenant rows where resolvable.
--
-- Schema note: archival_documents and investigations have NO tenant_id
-- column — chain through client_id → clients.tenant_id.
--
-- Resolution priority per row:
--   1. matched_entity_id → entities.tenant_id (analyst already linked it)
--   2. source_type='signal' → signals.tenant_id (direct)
--   3. source_type in (archival_document, document_upload, security_report)
--        → archival_documents.client_id → clients.tenant_id
--   4. source_type='investigation' → investigations.client_id → clients.tenant_id
--   5. created_by → tenant_users (single-tenant users only)
--   6. Rows whose source_id is a synthetic UUID (ai_assistant, agent_chat,
--      aegis_ai) and no created_by stay NULL — must be manually triaged
--      or remain visible only to super_admin.
--
-- Idempotent: only updates rows where tenant_id IS NULL.
-- Bounded: only touches entity_suggestions.
--
-- NOT NULL constraint deliberately NOT added yet — staging validation must
-- confirm new writes from all 9 writers carry tenant_id before tightening.
-- Tracked as #134-followup.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Backfill from matched_entity_id → entities.tenant_id ───────────────
UPDATE public.entity_suggestions s
SET tenant_id = e.tenant_id
FROM public.entities e
WHERE s.tenant_id IS NULL
  AND s.matched_entity_id IS NOT NULL
  AND e.id = s.matched_entity_id
  AND e.tenant_id IS NOT NULL;

-- ─── 2. Backfill from source_type='signal' → signals.tenant_id ─────────────
UPDATE public.entity_suggestions s
SET tenant_id = sig.tenant_id
FROM public.signals sig
WHERE s.tenant_id IS NULL
  AND s.source_type = 'signal'
  AND s.source_id = sig.id
  AND sig.tenant_id IS NOT NULL;

-- ─── 3. Backfill from archival_documents → client_id → clients.tenant_id ──
UPDATE public.entity_suggestions s
SET tenant_id = c.tenant_id
FROM public.archival_documents d
JOIN public.clients c ON c.id = d.client_id
WHERE s.tenant_id IS NULL
  AND s.source_type IN ('archival_document', 'document_upload', 'security_report')
  AND s.source_id = d.id
  AND c.tenant_id IS NOT NULL;

-- ─── 4. Backfill from investigations → client_id → clients.tenant_id ──────
UPDATE public.entity_suggestions s
SET tenant_id = c.tenant_id
FROM public.investigations i
JOIN public.clients c ON c.id = i.client_id
WHERE s.tenant_id IS NULL
  AND s.source_type = 'investigation'
  AND s.source_id = i.id
  AND c.tenant_id IS NOT NULL;

-- ─── 5. Backfill from created_by → tenant_users (single-tenant users only) ─
WITH single_tenant_users AS (
  SELECT user_id, tenant_id
  FROM (
    SELECT user_id, tenant_id, COUNT(*) OVER (PARTITION BY user_id) AS tenant_count
    FROM public.tenant_users
  ) x
  WHERE tenant_count = 1
)
UPDATE public.entity_suggestions s
SET tenant_id = stu.tenant_id
FROM single_tenant_users stu
WHERE s.tenant_id IS NULL
  AND s.created_by = stu.user_id;

COMMENT ON COLUMN public.entity_suggestions.tenant_id IS
  'Tenant ownership boundary. Must be set on INSERT — RLS for analysts/admins requires NOT NULL. All 9 writer functions enforce this. NOT NULL constraint deferred pending #134 staging validation.';
