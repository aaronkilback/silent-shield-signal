// P0 CONTAINMENT (2026-06-27): vip-deep-scan is intentionally DISABLED pending remediation of a
// confirmed authenticated cross-tenant write + integrity exposure (body client_id trusted without
// membership validation; stale schema writes to investigations/entity_relationships/signals;
// swallowed persistence failures). This handler returns temporary-unavailable BEFORE constructing
// any service-role client, performing any DB write, invoking any downstream function, or contacting
// any external provider. No tenant data is read or written.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "SERVICE_UNAVAILABLE",
      message: "vip-deep-scan is temporarily unavailable pending security remediation.",
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
