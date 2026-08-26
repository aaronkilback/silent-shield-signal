// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Deploy-drift orphan: verify_jwt=false, service-role, NO caller auth. Any signal_id -> created an
// incident (create_incident door) for that signal's client = unauthenticated write path. 503, no DB.
// Restore behind a service-role/caller gate (getCallerIdentity) — it is job-worker-invoked internal.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ disabled: true, message: "create-incident-job is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
