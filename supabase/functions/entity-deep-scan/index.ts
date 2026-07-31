// entity-deep-scan — CONTAINED 2026-07-31 (WO-CHECK5-BURNDOWN-01 batch 2).
// verify_jwt=false, no caller gate: any unauthenticated caller supplying entity_id triggered OSINT
// collection (external API spend) and WROTE entity_content — including the model-generated "sanctions/
// criminal/property" rows (WO-FABRICATED-FINDINGS-01) — onto ANY entity, including entities under legal hold,
// with no subject-of-interest gate (WO-SUBJECT-GATE-01). RESTORE ONLY after BOTH requireInternalCaller AND
// WO-SUBJECT-GATE-01 exist — not one or the other.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "entity-deep-scan is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
