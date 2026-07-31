// assess-entity — CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT / WO-CHECK5-BURNDOWN-01 batch 1).
// verify_jwt=false, service-role, NO caller gate: any unauthenticated caller supplying entityId read ANY
// entity and WROTE ai_assessment onto it (.update) — including entities under legal hold. Unauthenticated
// cross-tenant read + data-plane write. Restore behind getCallerIdentity + userCanAccessClient(entity.client_id).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "assess-entity is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
