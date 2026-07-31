// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Was a deploy-drift orphan: verify_jwt=false, service-role, read client_id from request and wrote
// signals.gate3 cross-client, gated only by a STATIC hardcoded shared secret (not a tenant-membership
// check) = check-2 shape + cross-client write. 503, no DB. Restore behind caller tenant_users membership.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ disabled: true, message: "compute-client-relevance is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
