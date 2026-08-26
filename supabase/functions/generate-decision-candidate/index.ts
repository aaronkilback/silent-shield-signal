// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Deploy-drift orphan: verify_jwt=false, service-role, NO caller auth. Any trigger_id ->
// wrote aegis_recommendations/decision-candidate objects and returned composed intelligence
// (recommendation, supporting signals, stake object) = unauthenticated write + read path.
// 503, no DB. Restore behind caller auth (getCallerIdentity + tenant membership).
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ disabled: true, message: "generate-decision-candidate is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
