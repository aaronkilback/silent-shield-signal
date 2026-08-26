// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Same pattern as ai-tools-query 48ff0c09. This was an unauthenticated / unscoped path to the
// person-entity PII class. Returns 503, creates NO service-role client, performs NO DB read.
// Restore only behind caller authentication + tenant_users membership scoping. Prior source in git.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "webhook-dispatcher is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30). No data returned." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
