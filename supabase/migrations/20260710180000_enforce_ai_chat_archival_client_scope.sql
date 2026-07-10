-- WO-DATA-INTEGRITY addendum (2026-07-10): server-side backstop for AI-chat
-- archival uploads.
--
-- Background: PR #135 (b507a515) added a client-side guard in
-- DashboardAIAssistant.tsx:871-874 that refuses ai-chat uploads when
-- !selectedClientId. Rule-3 browser check on 2026-07-10 found two orphans
-- (dab4a5fb-cc4a-4ab2-84da-369c65a635fe, 75fd5b9e-c3b7-4211-98ac-2fc67899cec3):
-- the deployed Worker bundle predated PR #135 because the frontend deploy
-- lane has been preflight-only since 2026-07-03 (WO-PRR frozen-lane cost
-- line). Single-layer defense — a stale JS bundle, opened dev-tools, or any
-- non-standard client defeats it. Doctrine (Provenance Doctrine rule 2):
-- service-role/frontend writers untrusted by default; enforcement at DB seam.
--
-- Effect: BEFORE INSERT trigger rejects archival_documents rows that are
-- code-signed as ai-chat (metadata->>source = 'ai-chat' OR tags contain
-- 'ai-chat-upload') AND have NULL client_id. The existing
-- archival_documents_provenance_check permits uploaded_by-owned NULL-client
-- rows for legitimate travel-security reference uploads — that path is
-- unaffected (those inserts don't carry ai-chat tags).
--
-- Enforcement-event convention (ratified 2026-07-10): every doctrine-mandated
-- trigger/guard we add carries a stable UPPERCASE token in its error DETAIL
-- so log analysis / watchdog can count enforcement events per guard.
-- This trigger's token: WO_DATA_INTEGRITY_ADDENDUM_AI_CHAT_CLIENT_SCOPE.

CREATE OR REPLACE FUNCTION enforce_ai_chat_archival_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_id IS NULL
     AND (
       COALESCE(NEW.metadata->>'source', '') = 'ai-chat'
       OR NEW.tags @> ARRAY['ai-chat-upload']::text[]
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'AI-chat archival uploads must be client-scoped (client_id required)',
      DETAIL  = format(
        'WO_DATA_INTEGRITY_ADDENDUM_AI_CHAT_CLIENT_SCOPE | metadata_source=%L | tags=%L | uploaded_by=%L',
        NEW.metadata->>'source', NEW.tags, NEW.uploaded_by
      ),
      HINT    = 'Select a client in the AEGIS chat before uploading, or route non-client-scoped reference docs through create-archival-record with explicit user-owned intent (no ai-chat tag/source).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ai_chat_archival_client_scope ON archival_documents;
CREATE TRIGGER trg_enforce_ai_chat_archival_client_scope
  BEFORE INSERT ON archival_documents
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ai_chat_archival_client_scope();

COMMENT ON FUNCTION enforce_ai_chat_archival_client_scope() IS
  'WO-DATA-INTEGRITY addendum 2026-07-10: server-side backstop preventing NULL-client archival inserts on the AI-chat path (source=ai-chat or tag=ai-chat-upload). Complements the frontend guard in DashboardAIAssistant.tsx and the DB provenance CHECK. Rejects with check_violation. Enforcement token: WO_DATA_INTEGRITY_ADDENDUM_AI_CHAT_CLIENT_SCOPE.';
