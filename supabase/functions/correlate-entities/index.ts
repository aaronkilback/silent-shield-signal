// correlate-entities — CONTAINED 2026-07-31 (WO-CHECK5-BURNDOWN-01 batch 2).
// verify_jwt=false, no caller gate: this is the pipeline intake — it auto-creates entities above a
// confidence threshold with NO subject-of-interest gate (WO-SUBJECT-GATE-01). Unauthenticated invocation
// grows the entity population. With a legal hold over that population, intake is closed too.
// Restore after requireInternalCaller + WO-SUBJECT-GATE-01.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "correlate-entities is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
