// =============================================================================
// ER v1 Slice 2 — Canonical write seam for suggested clusters
// =============================================================================
//
// This is the ONLY path through which Slice 2 writes to `actor_clusters` +
// `actor_cluster_members`. Centralizing the writer means:
//
//   • The tenant-match trigger fires through one well-known path (any direct
//     INSERT elsewhere would be a code-review red flag).
//   • Pre-flight tenant checks emit honest, operator-readable errors at the
//     API layer instead of relying on raw SQLSTATE 23514 propagation.
//   • The `axes_evidence` jsonb v:1 schema is composed in one place — no risk
//     of drift between callers.
//
// Per operator's most-important question: comparison results must be operator-
// reviewable. This module never writes silently; it returns the written rows
// so the edge function can surface them in its response.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AxesEvidenceV1 } from "./er-axes/_evidence-schema.ts";

export interface EntityProvenance {
  id: string;
  /** Will reject if NULL — ownerless entities cannot enter a cluster (Provenance Doctrine). */
  tenant_id: string | null;
  /** Anchor for the cluster_member.first_seen_at (denormalized for Cycling). */
  earliest_signal_at: string | null;
  /** Friendly name surfaced in evidence summaries / error messages. */
  name: string;
}

export interface WriteSuggestionInput {
  supabase: SupabaseClient;
  tenant_id: string;
  entity_a: EntityProvenance;
  entity_b: EntityProvenance;
  axes_evidence: AxesEvidenceV1;
  /** Plain-English summary that will land in `actor_clusters.summary_text`. */
  summary_text: string;
}

export interface WriteSuggestionResult {
  cluster_id: string;
  member_anchor_id: string;
  member_candidate_id: string;
}

/**
 * Pre-flight checks → INSERT cluster → INSERT both members. On any error the
 * caller receives a structured `WriteError` (no swallowed exceptions).
 */
export async function writeClusterSuggestion(
  input: WriteSuggestionInput,
): Promise<WriteSuggestionResult> {
  // §A — Pre-flight: honest refusal at the API layer (do NOT rely on the trigger to be the user-facing error).
  if (input.entity_a.tenant_id === null) {
    throw new WriteError(
      "entity_a_ownerless",
      `entity_a (${input.entity_a.name}) has no tenant ownership — cannot join a cluster (Provenance Doctrine)`,
    );
  }
  if (input.entity_b.tenant_id === null) {
    throw new WriteError(
      "entity_b_ownerless",
      `entity_b (${input.entity_b.name}) has no tenant ownership — cannot join a cluster (Provenance Doctrine)`,
    );
  }
  if (input.entity_a.tenant_id !== input.tenant_id) {
    throw new WriteError(
      "entity_a_cross_tenant",
      `entity_a tenant_id mismatch — comparison was requested under tenant ${input.tenant_id} ` +
      `but entity_a belongs to ${input.entity_a.tenant_id} (Aegis Authority + Memory)`,
    );
  }
  if (input.entity_b.tenant_id !== input.tenant_id) {
    throw new WriteError(
      "entity_b_cross_tenant",
      `entity_b tenant_id mismatch — comparison was requested under tenant ${input.tenant_id} ` +
      `but entity_b belongs to ${input.entity_b.tenant_id} (Aegis Authority + Memory)`,
    );
  }
  if (input.entity_a.id === input.entity_b.id) {
    throw new WriteError(
      "entity_self_comparison",
      `entity_a and entity_b are the same row (${input.entity_a.id}) — cannot suggest a cluster between identical entities`,
    );
  }
  if (input.axes_evidence.v !== 1) {
    throw new WriteError(
      "evidence_schema_version_mismatch",
      `axes_evidence schema version is ${input.axes_evidence.v}; writer requires v: 1`,
    );
  }

  // §B — INSERT the cluster row.
  //
  // G-3 (2026-06-01): UNKNOWN comparisons persist with status='auto_unknown'
  // distinct from 'suggested'. The operator review queue (Slice 5) filters
  // 'auto_unknown' out by default — preserving audit while preventing the
  // queue from drowning in sparse-data noise. See:
  //   docs/platform-operations/er-v1-slice-2-staging-jwt-platform-debt-…
  //   feedback_maintenance_debt_is_operational_risk
  const status =
    input.axes_evidence.cluster_confidence.cluster_confidence_class === "UNKNOWN"
      ? "auto_unknown"
      : "suggested";

  const { data: clusterRow, error: clusterErr } = await input.supabase
    .from("actor_clusters")
    .insert({
      tenant_id: input.tenant_id,
      status,
      summary_text: input.summary_text,
    })
    .select("id")
    .single();
  if (clusterErr || !clusterRow) {
    throw new WriteError(
      "cluster_insert_failed",
      `actor_clusters insert failed: ${clusterErr?.message ?? "unknown error"}`,
    );
  }
  const cluster_id = clusterRow.id as string;

  // §C — INSERT both members. If either fails the cluster row stays (suggested,
  // empty members) — the operator/cleanup job can purge orphan suggested clusters.
  // We surface the failure honestly rather than silently rolling back, because
  // the trigger is the non-bypassable guarantee and a member insert failure
  // signals something the operator needs to see.

  const firstSeenA = input.entity_a.earliest_signal_at ?? input.axes_evidence.computed_at;
  const firstSeenB = input.entity_b.earliest_signal_at ?? input.axes_evidence.computed_at;

  const { data: memberA, error: memberAErr } = await input.supabase
    .from("actor_cluster_members")
    .insert({
      cluster_id,
      entity_id: input.entity_a.id,
      role: "anchor",
      first_seen_at: firstSeenA,
      axes_evidence: input.axes_evidence,
    })
    .select("id")
    .single();
  if (memberAErr || !memberA) {
    throw new WriteError(
      "member_a_insert_failed",
      `actor_cluster_members (anchor=${input.entity_a.id}) insert failed: ${memberAErr?.message ?? "unknown error"}`,
    );
  }

  const { data: memberB, error: memberBErr } = await input.supabase
    .from("actor_cluster_members")
    .insert({
      cluster_id,
      entity_id: input.entity_b.id,
      role: "candidate",
      first_seen_at: firstSeenB,
      axes_evidence: input.axes_evidence,
    })
    .select("id")
    .single();
  if (memberBErr || !memberB) {
    throw new WriteError(
      "member_b_insert_failed",
      `actor_cluster_members (candidate=${input.entity_b.id}) insert failed: ${memberBErr?.message ?? "unknown error"}`,
    );
  }

  return {
    cluster_id,
    member_anchor_id: memberA.id as string,
    member_candidate_id: memberB.id as string,
  };
}

/** Structured error so the edge function can surface a clean refusal. */
export class WriteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ERWriteError";
  }
}
