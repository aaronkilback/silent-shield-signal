// EMERGENCY CONTAINMENT (2026-06-27): this alert-delivery route is a public privileged-action
// route (verify_jwt=false, no handler authorization before service-role + provider calls).
// CONTAINED: every non-OPTIONS request is denied with 503 BEFORE any service-role client,
// database read/write, provider initialization (Resend/Teams/Slack/Twilio), or downstream
// invocation. No provider clients are imported or initialized in this path.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: "SERVICE_UNAVAILABLE", message: "alert delivery is temporarily unavailable." }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
