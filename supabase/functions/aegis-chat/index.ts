// aegis-chat — CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT / WO-CHECK5-BURNDOWN-01 batch 1).
// verify_jwt=true but clientId was request-supplied (body.clientId) with NO caller-membership check,
// driving an agent tool loop over signals/entities/incidents — same cross-tenant shape as ai-tools-query
// (adce9554). Not fixed in place: verifying every tool in the loop re-scopes is the adce9554 trap.
// No direct caller (primary chat UI is dashboard-ai-assistant); containment breaks nothing currently wired.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "aegis-chat is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
