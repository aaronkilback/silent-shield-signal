// generate-lesson-video — CONTAINED 2026-07-30 (INC-AITOOLS-XTENANT-2026-07-30).
// Original: verify_jwt=false, service-role client, NO caller-identity gate. An unauthenticated
// caller supplying a moduleId could write academy_modules.video_status/video_error/heygen_video_id
// AND trigger a paid HeyGen video-generation call on demand (unauthenticated write + metered
// third-party API abuse). Disabled pending re-auth via the shared getCallerIdentity gate.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({
      disabled: true,
      message: "generate-lesson-video is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30).",
    }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
