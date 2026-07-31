// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Deploy-drift orphan: verify_jwt=false, service-role, NO webhook signature verification. A forged
// payload set academy_modules.video_url to an arbitrary URL + triggered Cloudflare Stream to copy an
// arbitrary URL = unauthenticated write + arbitrary-URL fetch. 503. Restore behind HeyGen signature verify.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ disabled: true, message: "heygen-webhook is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
