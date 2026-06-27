// STAGING SECURITY CONTAINMENT (Guard B) — voice-tool-executor-v2 is intentionally DISABLED on staging.
//
// Deliberate deny-all: NO database client, NO service-role credential, NO external calls,
// NO tenant data to any caller. Exists so the normal staging CI deploy path REPRODUCES
// containment while hardened restoration remains blocked pending security remediation.
// Hardened implementation + restoration plan + hashes:
//   docs/platform-operations/incidents/voice-tool-executor-v2-staging-containment.md
// Do NOT replace this with the hardened version without completing the approved remediation gates.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "SERVICE_UNAVAILABLE",
      message: "voice-tool-executor-v2 is disabled on staging pending security remediation.",
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
