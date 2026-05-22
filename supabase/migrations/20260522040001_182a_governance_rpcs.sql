-- #182A — Runtime governance backstop (Phase 1: SECURITY DEFINER persistence RPCs)
--
-- Companion to 20260522040000_182a_governance_backstop_phase1.sql.
-- Live staging history records the schema and RPCs as two separate
-- migrations (20260522164540 + 20260522164628); this file mirrors the
-- RPC half so a fresh database reconstructs identical history.
--
-- JWT CLAIM ACCESS
--   Supabase v2 PostgREST exposes JWT claims as a JSON object under
--   request.jwt.claims (not the legacy per-field request.jwt.claim.<field>).
--   governance_authorize parses the JSONB and falls back to current_role
--   when the GUC is unset (DB-direct psql, migrations, cron pg_net calls).

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. SECURITY DEFINER authorization helper
--    Centralizes intent-policy-table lookup so each RPC has identical auth semantics.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.governance_authorize(
  p_event governance_event_input
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_uid uuid;
  v_jwt_claims jsonb;
BEGIN
  -- Supabase pattern: claims live in request.jwt.claims as JSON. Fall back to current_role only for DB-direct calls.
  BEGIN
    v_jwt_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_jwt_claims := NULL;
  END;
  v_caller_role := COALESCE(v_jwt_claims->>'role', current_role::text);
  v_caller_uid  := nullif(v_jwt_claims->>'sub', '')::uuid;

  IF p_event.tenant_id IS NULL THEN
    RAISE EXCEPTION '#182 AUTH: tenant_id is required regardless of caller_intent';
  END IF;
  IF p_event.source_writer IS NULL OR p_event.source_writer = '' THEN
    RAISE EXCEPTION '#182 AUTH: source_writer is required regardless of caller_intent';
  END IF;
  IF p_event.caller_intent IS NULL THEN
    RAISE EXCEPTION '#182 AUTH: caller_intent is required (no implicit bypass)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.entity_governance_writer_policy
    WHERE source_writer = p_event.source_writer
      AND allowed_intent = p_event.caller_intent
      AND active = true
  ) THEN
    RAISE EXCEPTION '#182 AUTH: source_writer % not authorized for intent % (consult entity_governance_writer_policy)',
                    p_event.source_writer, p_event.caller_intent;
  END IF;

  CASE p_event.caller_intent
    WHEN 'operator_action' THEN
      IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION '#182 AUTH: operator_action requires authenticated user JWT (sub claim missing; role=%)', v_caller_role;
      END IF;
      IF NOT (
        EXISTS (SELECT 1 FROM public.tenant_users WHERE user_id = v_caller_uid AND tenant_id = p_event.tenant_id)
        OR public.is_super_admin(v_caller_uid)
      ) THEN
        RAISE EXCEPTION '#182 AUTH: operator_action caller % not authorized for tenant %', v_caller_uid, p_event.tenant_id;
      END IF;
    WHEN 'autonomous_system' THEN
      IF v_caller_role <> 'service_role' THEN
        RAISE EXCEPTION '#182 AUTH: autonomous_system requires service_role JWT claim (got %)', COALESCE(v_caller_role, '<none>');
      END IF;
    WHEN 'migration' THEN
      IF v_caller_role NOT IN ('service_role','postgres') THEN
        RAISE EXCEPTION '#182 AUTH: migration intent requires service_role or postgres role (got %)', COALESCE(v_caller_role, '<none>');
      END IF;
      IF p_event.bypass_metadata IS NULL OR NOT (p_event.bypass_metadata ? 'migration_id') THEN
        RAISE EXCEPTION '#182 AUTH: migration intent requires bypass_metadata.migration_id';
      END IF;
    WHEN 'maintenance' THEN
      IF v_caller_uid IS NULL OR NOT public.is_super_admin(v_caller_uid) THEN
        RAISE EXCEPTION '#182 AUTH: maintenance intent requires authenticated super_admin (got user %, role %)', v_caller_uid, v_caller_role;
      END IF;
      IF p_event.bypass_metadata IS NULL OR NOT (p_event.bypass_metadata ? 'reason') THEN
        RAISE EXCEPTION '#182 AUTH: maintenance intent requires bypass_metadata.reason';
      END IF;
      IF length(coalesce(p_event.bypass_metadata->>'reason','')) < 20 THEN
        RAISE EXCEPTION '#182 AUTH: maintenance reason must be >=20 chars';
      END IF;
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.governance_authorize FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.governance_authorize TO service_role, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Persistence RPCs — atomic (audit-first transactional)
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. Event-only (verdict in {auto_link, auto_reject})
CREATE OR REPLACE FUNCTION public.governance_persist_event_only(
  p_event governance_event_input
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_event_id uuid;
BEGIN
  PERFORM public.governance_authorize(p_event);
  INSERT INTO public.entity_governance_events (
    tenant_id, source_writer, candidate_name, candidate_type, candidate_origin,
    verdict, rejection_reasons, warnings, confidence,
    source_context, bypass_metadata, linked_entity_id
  ) VALUES (
    p_event.tenant_id, p_event.source_writer, p_event.candidate_name, p_event.candidate_type, p_event.candidate_origin,
    p_event.verdict, COALESCE(p_event.rejection_reasons,'{}'), COALESCE(p_event.warnings,'{}'), p_event.confidence,
    p_event.source_context, p_event.bypass_metadata, p_event.linked_entity_id
  ) RETURNING id INTO v_event_id;
  RETURN v_event_id;
END $$;

REVOKE ALL ON FUNCTION public.governance_persist_event_only FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.governance_persist_event_only TO service_role, authenticated;

-- 7b. Event + entity_suggestion (verdict='suggestion_queue') — audit-first transactional
CREATE OR REPLACE FUNCTION public.governance_persist_suggestion(
  p_event governance_event_input,
  p_suggestion entity_suggestion_input
) RETURNS TABLE(event_id uuid, suggestion_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_event_id uuid; v_suggestion_id uuid;
BEGIN
  PERFORM public.governance_authorize(p_event);
  IF p_event.verdict <> 'suggestion_queue' THEN
    RAISE EXCEPTION '#182 INVARIANT: governance_persist_suggestion requires verdict=suggestion_queue (got %)', p_event.verdict;
  END IF;
  IF p_suggestion.tenant_id IS DISTINCT FROM p_event.tenant_id THEN
    RAISE EXCEPTION '#182 TENANT_MISMATCH: suggestion tenant_id % differs from event tenant_id %', p_suggestion.tenant_id, p_event.tenant_id;
  END IF;
  INSERT INTO public.entity_governance_events (
    tenant_id, source_writer, candidate_name, candidate_type, candidate_origin,
    verdict, rejection_reasons, warnings, confidence, source_context, bypass_metadata
  ) VALUES (
    p_event.tenant_id, p_event.source_writer, p_event.candidate_name, p_event.candidate_type, p_event.candidate_origin,
    p_event.verdict, COALESCE(p_event.rejection_reasons,'{}'), COALESCE(p_event.warnings,'{}'), p_event.confidence,
    p_event.source_context, p_event.bypass_metadata
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.entity_suggestions (
    tenant_id, suggested_name, suggested_type, suggested_aliases, suggested_attributes,
    source_type, source_id, confidence, context, status, matched_entity_id, governance_event_id
  ) VALUES (
    p_suggestion.tenant_id, p_suggestion.suggested_name, p_suggestion.suggested_type,
    COALESCE(p_suggestion.suggested_aliases,'{}'), COALESCE(p_suggestion.suggested_attributes, '{}'::jsonb),
    p_suggestion.source_type, p_suggestion.source_id, p_suggestion.confidence,
    p_suggestion.context, COALESCE(p_suggestion.status,'pending'), p_suggestion.matched_entity_id, v_event_id
  ) RETURNING id INTO v_suggestion_id;

  UPDATE public.entity_governance_events SET suggestion_id = v_suggestion_id WHERE id = v_event_id;
  RETURN QUERY SELECT v_event_id, v_suggestion_id;
END $$;

REVOKE ALL ON FUNCTION public.governance_persist_suggestion FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.governance_persist_suggestion TO service_role, authenticated;

-- 7c. Event + entity (verdict='operator_promoted') — audit-first transactional
CREATE OR REPLACE FUNCTION public.governance_persist_entity(
  p_event governance_event_input,
  p_entity entity_input
) RETURNS TABLE(event_id uuid, entity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_event_id uuid; v_entity_id uuid;
BEGIN
  PERFORM public.governance_authorize(p_event);
  IF p_event.verdict <> 'operator_promoted' THEN
    RAISE EXCEPTION '#182 INVARIANT: governance_persist_entity requires verdict=operator_promoted (got %)', p_event.verdict;
  END IF;
  IF p_entity.tenant_id IS DISTINCT FROM p_event.tenant_id THEN
    RAISE EXCEPTION '#182 TENANT_MISMATCH: entity tenant_id % differs from event tenant_id %', p_entity.tenant_id, p_event.tenant_id;
  END IF;
  IF p_event.bypass_metadata IS NULL OR NOT (p_event.bypass_metadata ? 'operator_id') OR NOT (p_event.bypass_metadata ? 'reason') THEN
    RAISE EXCEPTION '#182 AUDIT: operator_promoted requires bypass_metadata.operator_id AND .reason';
  END IF;

  INSERT INTO public.entity_governance_events (
    tenant_id, source_writer, candidate_name, candidate_type, candidate_origin,
    verdict, rejection_reasons, warnings, confidence, source_context, bypass_metadata
  ) VALUES (
    p_event.tenant_id, p_event.source_writer, p_event.candidate_name, p_event.candidate_type, p_event.candidate_origin,
    p_event.verdict, COALESCE(p_event.rejection_reasons,'{}'), COALESCE(p_event.warnings,'{}'), p_event.confidence,
    p_event.source_context, p_event.bypass_metadata
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.entities (
    tenant_id, name, type, description, aliases,
    risk_level, threat_score, threat_indicators, associations, attributes,
    address_street, address_city, address_province, address_postal_code, address_country,
    current_location, active_monitoring_enabled, monitoring_radius_km,
    client_id, confidence_score, is_active, entity_status, visibility_class,
    governance_event_id
  ) VALUES (
    p_entity.tenant_id, p_entity.name, p_entity.type, p_entity.description, p_entity.aliases,
    p_entity.risk_level, p_entity.threat_score, p_entity.threat_indicators, p_entity.associations, p_entity.attributes,
    p_entity.address_street, p_entity.address_city, p_entity.address_province, p_entity.address_postal_code, p_entity.address_country,
    p_entity.current_location, p_entity.active_monitoring_enabled, p_entity.monitoring_radius_km,
    p_entity.client_id, p_entity.confidence_score, p_entity.is_active, p_entity.entity_status, p_entity.visibility_class,
    v_event_id
  ) RETURNING id INTO v_entity_id;

  UPDATE public.entity_governance_events SET linked_entity_id = v_entity_id WHERE id = v_event_id;
  RETURN QUERY SELECT v_event_id, v_entity_id;
END $$;

REVOKE ALL ON FUNCTION public.governance_persist_entity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.governance_persist_entity TO service_role, authenticated;

COMMIT;
