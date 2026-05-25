// _shared/admission/wiring.ts
// ingest-signal ↔ controller wiring helpers (Phase B). Pure + testable.
//
// mapResultToResponse: turns a TERMINAL AdmissionResult into the EXACT legacy HTTP Response.
// Each stage's terminal result already carries `body` (the verbatim object legacy passed to
// JSON.stringify) + `httpStatusHint` (the legacy status), so this is a faithful serialize — the
// byte-parity guarantee is structural (same body object, same status). 'admitted' results have
// NO body here: on the admitted path the post-insert orchestration tail (in ingest-signal) builds
// the success response, so the flag-on caller continues to the tail rather than calling this.
//
// NOTE (wiring gap, see report): buildWorkingSignal is intentionally NOT defined yet. The
// request→WorkingSignal mapping depends on a prep region (signalRaw + novelty raw_json mutations
// [DB], sourceId [source-lookup], rulesSeverity [applyRules], and signalTitle [generateTitle,
// post-classify]) that the five gate/insert slices did not lift. That prep must be lifted (a prep
// slice) before buildWorkingSignal can produce a request→insert-payload-faithful WorkingSignal.
import type { AdmissionResult } from "./types.ts";

export function mapResultToResponse(result: AdmissionResult, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.httpStatusHint,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
