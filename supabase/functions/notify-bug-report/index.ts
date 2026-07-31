// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Deploy-drift orphan: verify_jwt=false, service-role, NO caller gate. Any bug_id -> read the
// bug_reports row (tenant/client/conversation/screenshot signed URLs) and SENT email (Resend) + SMS
// (Twilio) = unauthenticated read + mail send. 503. Restore behind a service-role gate (getCallerIdentity).
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ disabled: true, message: "notify-bug-report is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
