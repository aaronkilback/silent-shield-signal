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
import type { AdmissionContext, AdmissionResult, Classification, SignalCandidate } from "./types.ts";
import { runExternalCrawledAdmission } from "./profiles/external-crawled.ts";
export { dgicStage } from "./dgic-stage.ts"; // re-export the seam (defined in its own module to avoid a controller↔profile import cycle)

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

