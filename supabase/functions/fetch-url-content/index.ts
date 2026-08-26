// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Unauthenticated SSRF surface: fetched a request-supplied URL; denylist guard was bypassable via
// redirect-follow (not re-validated) and DNS rebinding. Returns 503, no fetch, no DB. Restore only
// behind caller auth + redirect/IP re-validation. (Was a deploy-drift orphan; landing it here too.)
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "fetch-url-content is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30, SSRF). No fetch performed." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
