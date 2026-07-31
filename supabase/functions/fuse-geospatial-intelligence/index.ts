// fuse-geospatial-intelligence — CONTAINED 2026-07-31 (WO-CHECK5-BURNDOWN-01 batch 3), de-provision pending.
// verify_jwt=false, no caller gate. No functional caller found (only e2eTests.ts + the deployment-verification
// smoke manifest reference it — neither is a real invoker). Contained; DELETE pending operator confirm +
// removal of the smoke-manifest / e2e references.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({ disabled: true, message: "fuse-geospatial-intelligence is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
