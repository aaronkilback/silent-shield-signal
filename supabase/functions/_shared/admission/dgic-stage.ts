// _shared/admission/dgic-stage.ts
// The DGIC evaluation seam. Placed by the profile pipeline AFTER relevance, BEFORE the insert.
// PHASE B: no-op pass-through — admits unchanged (no stamp, no quarantine, no quality_status
// change). FUTURE P1 (audit-only): stamp dgic.* on the row, still `continue`. FUTURE (enforce):
// return a terminal result on sub_grade / evaluator-error (fail-closed). One declared insertion
// point so later phases never re-thread the controller.
import type { AdmissionContext, StageResult } from "./types.ts";

export async function dgicStage(_working: unknown, _ctx: AdmissionContext): Promise<StageResult> {
  return { kind: "continue" };
}
