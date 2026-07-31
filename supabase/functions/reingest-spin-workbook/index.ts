// reingest-spin-workbook — CONTAINED 2026-07-30 (INC-AITOOLS-XTENANT-2026-07-30).
// Original: verify_jwt=false, service-role client, NO caller-identity gate. An unauthenticated
// caller supplying a document_id could (a) dry_run to read a tenant's stored xlsx + analytics
// back over HTTP, or (b) rewrite that tenant's archival_documents.content_text/metadata.
// = unauthenticated read of tenant data + unauthenticated write. Disabled pending re-auth via
// the shared getCallerIdentity + tenant-membership gate.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({
      disabled: true,
      message: "reingest-spin-workbook is disabled for security containment (INC-AITOOLS-XTENANT-2026-07-30).",
    }),
    { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
