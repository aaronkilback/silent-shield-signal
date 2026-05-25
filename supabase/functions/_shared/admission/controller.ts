// _shared/admission/controller.ts
// DGIC canonical admission controller (Phase B: controller extraction).
//
// Boundary: up to and INCLUDING the signals insert. The post-insert orchestration tail
// (x_quota, embeddings, duplicate_detections, expert_context, incidents, alerts,
// ai-decision-engine, webhook-dispatcher, alert-delivery, correlate-signals,
// enqueue_signal_processing) STAYS in the caller (ingest-signal), unmoved — keeps parity
// testable and avoids dry-running high-side-effect downstream operations.
//
// Phase B: NO DGIC enforcement, NO quality_status change, NO schema stamp. The dgicStage seam
// is a no-op pass-through. External/crawled is behavior-equivalent to today's ingest-signal.
import type { AdmissionContext, AdmissionResult, Classification, SignalCandidate, StageResult } from "./types.ts";
import { runExternalCrawledAdmission } from "./profiles/external-crawled.ts";

export class NotImplementedMode extends Error {}

export async function admitSignal(
  candidate: SignalCandidate,
  cls: Classification,
  ctx: AdmissionContext,
): Promise<AdmissionResult> {
  if (cls.mode === "external" && cls.acquisition === "crawled") {
    return await runExternalCrawledAdmission(candidate, ctx);
  }
  // external/supplied, asserted/document, synthetic land in later slices; no callers yet.
  throw new NotImplementedMode(`admission mode not implemented: ${JSON.stringify(cls)}`);
}

/**
 * DGIC evaluation seam. Placed by each profile AFTER relevanceGate, BEFORE the signals insert.
 * PHASE B: no-op pass-through — admits unchanged.
 * FUTURE P1 (audit-only): stamp dgic.* on the row, still `continue`.
 * FUTURE (enforce): return a terminal result on sub_grade / evaluator-error (fail-closed).
 * Declaring it now means later phases insert at ONE point, never re-threading the controller.
 */
export async function dgicStage(_working: unknown, _ctx: AdmissionContext): Promise<StageResult> {
  return { kind: "continue" };
}
