const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generic Tool Path Clearance Phase A2 (2026-06-12) — STOPGAP CONTAINMENT.
// ai-tools-query (prev v78) exposed ~15 UNSCOPED tools (get_recent_signals, get_active_incidents,
// search_entities, search_clients, search_signals, search_investigations, get_client_risk_summary,
// etc.) returning operational data across ALL tenants, and even its tenant-scoped tools
// (query_fortress_data, update_risk_profile, lookup_ioc_indicator) derived scope from a
// CALLER-SUPPLIED tenant_id rather than an authenticated JWT — all under verify_jwt=false, so an
// unauthenticated caller (public apikey, no user JWT) could read cross-tenant operational data.
// Its prior kill-switch was default-ON (absent env = enabled) and therefore unreliable.
// HARD-DISABLED: returns 503 with NO service-role client created and NO DB read; body/model args
// cannot override. Re-enable requires a caller->scope gate (getCallerIdentity +
// getAccessibleClientIds + reject body/model tenant/client mismatch + fail-closed) — Generic Tool
// Path Clearance Phase B. The prior v78 tool implementations are recoverable from the
// deployed-bundle history captured in the Phase-audit; Phase B restores them behind the gate.
// NOTE: this repo source MIRRORS deployed v79 (MCP-deployed). Do not "restore" the prior
// vulnerable implementation; rebuild behind the caller->scope gate instead.
Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      disabled: true,
      message: "ai-tools-query is disabled for security containment (Generic Tool Path Clearance Phase A). No data returned; a caller->scope gate is required before re-enable.",
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
