const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generic Tool Path Clearance Phase A1 (2026-06-12) — STOPGAP CONTAINMENT.
// query-fortress-data was an UNGATED service-role reader: verify_jwt=false, no caller auth,
// body filters.client_id controlled scope, fail-OPEN when omitted -> an unauthenticated caller
// could read the entire database across all tenants (signals/incidents/entities/clients/
// archival_documents/investigations/expert_knowledge/monitoring_history/itineraries+travelers).
// It has NO application callers (orphaned). HARD-DISABLED: returns 403 with NO service-role
// client created and NO DB read; body/model args cannot override. A real re-enable requires a
// caller->scope gate (getCallerIdentity + getAccessibleClientIds + reject body/model client_id
// mismatch + fail-closed) — Generic Tool Path Clearance Phase B.
// NOTE: this repo source MIRRORS deployed v73 (MCP-deployed). Do not "restore" the prior
// vulnerable implementation; rebuild behind the caller->scope gate instead.
Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      disabled: true,
      error: "query-fortress-data is disabled for security containment (Generic Tool Path Clearance Phase A). No data returned; a caller->scope gate is required before re-enable.",
    }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
