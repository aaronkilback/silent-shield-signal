// CONTAINED 2026-07-31 (INC-AITOOLS-XTENANT-2026-07-30) — HARD-DISABLED.
// Deploy-drift orphan: verify_jwt=false, service-role, gated ONLY by the static secret
// x-smoke-key static secret (value COMPROMISED — leaked to a transcript; scrubbed from repo,
// was the SAME literal compute-client-relevance used). It read EVERY tenant
// storage bucket (investigation-files, hostile-evidence, cipher-evidence, archival-documents,
// tenant-files), copied all objects to R2, and could DELETE arbitrary R2 objects (cleanup_key).
// 503. Restore behind a real auth gate (service-role / rotated secret from vault), never a hardcoded one.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ disabled: true, message: "dr-storage-backup is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30)." }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
