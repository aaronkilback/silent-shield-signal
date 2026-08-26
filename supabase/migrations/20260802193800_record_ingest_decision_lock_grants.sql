-- WO-GATE Phase 2: deny-by-default on the write seam. record_ingest_decision is SECURITY DEFINER
-- and must be callable only by service_role (invoked from process-intelligence-document's service-role
-- client). Keep anon/authenticated out. Applied to prod 2026-08-02 via MCP; committed for git/DR parity.
revoke execute on function public.record_ingest_decision(uuid,uuid,text,text,text,text,text,text,boolean,numeric,uuid[],uuid,text) from public, anon, authenticated;
grant  execute on function public.record_ingest_decision(uuid,uuid,text,text,text,text,text,text,boolean,numeric,uuid[],uuid,text) to service_role;
