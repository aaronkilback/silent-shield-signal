// =============================================================================
// er-compare-entities — ER v1 Slice 2 evidence-engine edge function
// =============================================================================
//
// Authorization: Operator GO 2026-06-01.
//
// Operator-initiated pairwise entity comparison. Tenant-scoped. Service-role
// auth (no end-user JWT today; Slice 3 surfaces this through Aegis chat which
// handles its own auth).
//
// Honors the operator's UNKNOWN-first amendment: insufficient evidence cannot
// produce LOW. The sufficiency gate fires before any predicate aggregation.
//
// What this function does NOT do (per Slice 2 scope, explicit operator approval):
//   • Does not autonomously enumerate candidate pairs (no autonomous clustering).
//   • Does not mutate `entities` or any other table beyond `actor_clusters` +
//     `actor_cluster_members`.
//   • Does not surface to Aegis chat or workspace UI (Slices 3–4).
//   • Does not implement operator confirm/reject UI (Slice 5).
//   • Does not change Capability Registry status (Slice 6).
//
// What this function DOES guarantee:
//   • Tenant-match trigger fail-close is pre-checked at the API layer so the
//     caller sees an honest refusal instead of raw SQLSTATE 23514.
//   • Deterministic axis math — same inputs produce the same output.
//   • All evidence is operator-reviewable (concrete numbers, term lists, source
//     class lists) — never opaque scores.
//
// Request shape:
//   POST { tenant_id: uuid, entity_a_id: uuid, entity_b_id: uuid, debug_trace_id?: uuid }
//
// Response shape (200):
//   { ok: true, cluster_id, member_anchor_id, member_candidate_id, axes_evidence }
//
// Refusal shape (4xx):
//   { ok: false, code, message } — codes documented in er-write-suggestion.ts WriteError

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startTrace } from "../_shared/flight-recorder.ts";
import { computePostingTimeAxis } from "../_shared/er-axes/posting-time.ts";
import type { TemporalGroundingValue } from "../_shared/temporal-grounding.ts";
import { computeVocabularyAxis, tokenize } from "../_shared/er-axes/vocabulary.ts";
import { computeSourceClassAxis } from "../_shared/er-axes/source-class.ts";
import { assembleAxesEvidence } from "../_shared/er-cluster-confidence.ts";
import { writeClusterSuggestion, WriteError, type EntityProvenance } from "../_shared/er-write-suggestion.ts";

// ─────────────────────────────────────────────────────────────────────────────
// §A — Constants
// ─────────────────────────────────────────────────────────────────────────────

const SIGNAL_LOOKBACK_DAYS = 180; // limit to the last 180d for relevance + cost
const MAX_SIGNALS_PER_ACTOR = 1000; // budget per side
const GLOBAL_DF_SAMPLE_LIMIT = 2000; // sample tenant signals to build the DF table

// ─────────────────────────────────────────────────────────────────────────────
// §B — Helpers (data retrieval; tenant-scoped, quarantine-filtered)
// ─────────────────────────────────────────────────────────────────────────────

interface SignalRow {
  id: string;
  created_at: string;
  /** G-9: actor/event timestamp — the only field that can carry actor-time. */
  event_date: string | null;
  /** G-9: explicit grounding column (100% 'unknown' in prod today). */
  temporal_grounding: string | null;
  title: string | null;
  normalized_text: string | null;
  raw_json: Record<string, unknown> | null;
  source_id: string | null;
}

async function loadSignalsForEntity(
  // deno-lint-ignore no-explicit-any
  sb: any,
  tenantId: string,
  entityId: string,
): Promise<{ signals: SignalRow[]; sourceLabels: string[]; truncated: boolean }> {
  // Resolve signal ids via entity_mentions, then load the signals tenant-scoped
  // with the quarantine filter applied at SQL level (not in-process).
  const cutoff = new Date(Date.now() - SIGNAL_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: mentions, error: mErr } = await sb
    .from("entity_mentions")
    .select("signal_id")
    .eq("entity_id", entityId)
    .order("detected_at", { ascending: false })
    .limit(MAX_SIGNALS_PER_ACTOR);
  if (mErr) throw new Error(`entity_mentions load failed: ${mErr.message}`);
  // G-4: the mentions query is capped at MAX_SIGNALS_PER_ACTOR; if we hit the cap
  // the comparison saw a truncated view of the actor's history.
  const truncated = (mentions || []).length >= MAX_SIGNALS_PER_ACTOR;
  const signalIds = Array.from(new Set((mentions || []).map((m: { signal_id: string }) => m.signal_id).filter(Boolean)));
  if (signalIds.length === 0) return { signals: [], sourceLabels: [], truncated };

  const { data: signalsRaw, error: sErr } = await sb
    .from("signals")
    .select("id, created_at, event_date, temporal_grounding, title, normalized_text, raw_json, source_id, quality_status")
    .eq("tenant_id", tenantId)
    .neq("quality_status", "quarantined")
    .in("id", signalIds)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });
  if (sErr) throw new Error(`signals load failed: ${sErr.message}`);

  // Resolve source labels (raw_json.source first; fall back to source_id → sources.name).
  const signals = (signalsRaw || []) as SignalRow[];
  const sourceLabels: string[] = [];
  const sourceIdsToResolve = new Set<string>();
  for (const s of signals) {
    const rawSource = (s.raw_json && typeof s.raw_json === "object")
      ? (s.raw_json as Record<string, unknown>).source
      : undefined;
    if (typeof rawSource === "string" && rawSource.trim()) {
      sourceLabels.push(rawSource);
    } else if (s.source_id) {
      sourceIdsToResolve.add(s.source_id);
    }
  }
  if (sourceIdsToResolve.size > 0) {
    const { data: srcRows } = await sb
      .from("sources")
      .select("id, name")
      .in("id", Array.from(sourceIdsToResolve));
    const idToName = new Map<string, string>((srcRows || []).map((r: { id: string; name: string }) => [r.id, r.name]));
    for (const s of signals) {
      if (s.source_id && idToName.has(s.source_id)) {
        sourceLabels.push(idToName.get(s.source_id)!);
      }
    }
  }
  return { signals, sourceLabels, truncated };
}

/** Build a tenant-scoped document-frequency table by sampling recent signals. */
async function buildTenantDf(
  // deno-lint-ignore no-explicit-any
  sb: any,
  tenantId: string,
): Promise<{ df: Map<string, number>; globalSignalCount: number; sampleSha256: string | null }> {
  const cutoff = new Date(Date.now() - SIGNAL_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await sb
    .from("signals")
    .select("id, title, normalized_text")
    .eq("tenant_id", tenantId)
    .neq("quality_status", "quarantined")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(GLOBAL_DF_SAMPLE_LIMIT);
  if (error) throw new Error(`tenant DF sample failed: ${error.message}`);
  const rows = (data || []) as { id: string; title: string | null; normalized_text: string | null }[];
  const df = new Map<string, number>();
  for (const r of rows) {
    const text = `${r.title || ""} ${r.normalized_text || ""}`;
    const distinct = new Set(tokenize(text));
    for (const t of distinct) df.set(t, (df.get(t) || 0) + 1);
  }
  // G-4: deterministic fingerprint of the DF basis (sorted ids → SHA-256).
  const sampleSha256 = await sha256Hex(rows.map((r) => r.id).sort().join(","));
  return { df, globalSignalCount: rows.length, sampleSha256 };
}

/** SHA-256 of a string as lowercase hex. Used for the G-4 df_sample fingerprint. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadEntityProvenance(
  // deno-lint-ignore no-explicit-any
  sb: any,
  entityId: string,
): Promise<EntityProvenance | null> {
  const { data, error } = await sb
    .from("entities")
    .select("id, name, tenant_id")
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(`entities load failed: ${error.message}`);
  if (!data) return null;
  // earliest_signal_at: derived from the entity's earliest non-quarantined signal mention
  const { data: earliest } = await sb
    .from("entity_mentions")
    .select("signal_id, detected_at")
    .eq("entity_id", entityId)
    .order("detected_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    id: data.id,
    name: data.name,
    tenant_id: data.tenant_id,
    earliest_signal_at: earliest?.detected_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §C — Edge function entry point
// ─────────────────────────────────────────────────────────────────────────────

interface RequestBody {
  tenant_id?: string;
  entity_a_id?: string;
  entity_b_id?: string;
  debug_trace_id?: string;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, code: "method_not_allowed", message: "POST required" });
  }

  let body: RequestBody;
  try { body = await req.json(); } catch {
    return jsonResponse(400, { ok: false, code: "invalid_json", message: "request body must be JSON" });
  }

  const tenantId = body.tenant_id?.trim();
  const aId = body.entity_a_id?.trim();
  const bId = body.entity_b_id?.trim();
  if (!tenantId || !aId || !bId) {
    return jsonResponse(400, {
      ok: false, code: "missing_fields",
      message: "tenant_id, entity_a_id, entity_b_id all required",
    });
  }
  if (aId === bId) {
    return jsonResponse(400, {
      ok: false, code: "entity_self_comparison",
      message: "entity_a_id and entity_b_id must differ",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { ok: false, code: "config_error", message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" });
  }
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const recorder = startTrace(sb, {
    debugTraceId: body.debug_trace_id,
    functionName: "er-compare-entities",
    actorSurface: "aegis",
    tenantId,
  });

  try {
    // §C.1 — Load entity provenance & verify tenant ownership BEFORE doing math.
    const [entityA, entityB] = await Promise.all([
      loadEntityProvenance(sb, aId),
      loadEntityProvenance(sb, bId),
    ]);
    if (!entityA) {
      recorder.tool({ toolName: "loadEntityProvenance", scopedTenantId: tenantId, outcome: "refused", refusalReason: "entity_a_not_found" });
      await recorder.finish({ status: "refused" });
      return jsonResponse(404, { ok: false, code: "entity_a_not_found", message: `entity_a_id ${aId} not found`, debug_trace_id: recorder.traceId });
    }
    if (!entityB) {
      recorder.tool({ toolName: "loadEntityProvenance", scopedTenantId: tenantId, outcome: "refused", refusalReason: "entity_b_not_found" });
      await recorder.finish({ status: "refused" });
      return jsonResponse(404, { ok: false, code: "entity_b_not_found", message: `entity_b_id ${bId} not found`, debug_trace_id: recorder.traceId });
    }

    // §C.2 — Load tenant-scoped signal + source data for each actor.
    const tStart = Date.now();
    const [aData, bData, tenantDf] = await Promise.all([
      loadSignalsForEntity(sb, tenantId, aId),
      loadSignalsForEntity(sb, tenantId, bId),
      buildTenantDf(sb, tenantId),
    ]);
    recorder.retrieval({
      surface: "er_compare:entity_a_signals",
      tenantScope: tenantId,
      returnedObjectIds: aData.signals.map((s) => s.id),
      timingMs: Date.now() - tStart,
    });
    recorder.retrieval({
      surface: "er_compare:entity_b_signals",
      tenantScope: tenantId,
      returnedObjectIds: bData.signals.map((s) => s.id),
      timingMs: Date.now() - tStart,
    });
    recorder.retrieval({
      surface: "er_compare:tenant_df_sample",
      tenantScope: tenantId,
      provenance: { sample_size: tenantDf.globalSignalCount },
    });

    // §C.3 — Compute axes deterministically. Skip nothing — emit insufficient_samples per axis if sparse.
    // G-9: pass full signal records; the axis filters to actor-time-grounded
    // signals and buckets on event_date (never created_at). G-4: time each axis.
    const tPosting = Date.now();
    const postingTime = computePostingTimeAxis({
      signalsA: aData.signals.map((s) => ({
        created_at: s.created_at,
        event_date: s.event_date,
        temporal_grounding: s.temporal_grounding as TemporalGroundingValue | null,
      })),
      signalsB: bData.signals.map((s) => ({
        created_at: s.created_at,
        event_date: s.event_date,
        temporal_grounding: s.temporal_grounding as TemporalGroundingValue | null,
      })),
    });
    const postingTimeMs = Date.now() - tPosting;
    const tVocab = Date.now();
    const textsA = aData.signals.map((s) => `${s.title || ""} ${s.normalized_text || ""}`);
    const textsB = bData.signals.map((s) => `${s.title || ""} ${s.normalized_text || ""}`);
    const vocabulary = computeVocabularyAxis({
      textsA, textsB,
      globalDf: tenantDf.df,
      globalSignalCount: tenantDf.globalSignalCount,
    });
    const vocabularyMs = Date.now() - tVocab;
    const tSource = Date.now();
    const sourceClass = computeSourceClassAxis({
      sourceLabelsA: aData.sourceLabels, sourceLabelsB: bData.sourceLabels,
    });
    const sourceClassMs = Date.now() - tSource;

    // §C.4 — Assemble evidence + cluster confidence (sufficiency-first).
    const axesEvidence = assembleAxesEvidence({
      tenant_id: tenantId,
      entity_a_id: aId,
      entity_b_id: bId,
      flight_recorder_trace_id: recorder.traceId,
      postingTime, vocabulary, sourceClass,
    });
    // G-4: attach debuggability telemetry (additive; not load-bearing for verdict).
    axesEvidence.telemetry = {
      axis_timing_ms: {
        posting_time: postingTimeMs,
        vocabulary: vocabularyMs,
        source_class: sourceClassMs,
      },
      signals_truncated_a: aData.truncated,
      signals_truncated_b: bData.truncated,
      df_sample_sha256: tenantDf.sampleSha256,
    };

    // §C.5 — Persist via the canonical writer (trigger pre-flight enforced).
    const summary =
      `Suggested cluster between "${entityA.name}" and "${entityB.name}": ` +
      `${axesEvidence.cluster_confidence.cluster_confidence_class} — ${axesEvidence.cluster_confidence.rationale}`;

    let writeResult;
    try {
      writeResult = await writeClusterSuggestion({
        supabase: sb,
        tenant_id: tenantId,
        entity_a: entityA,
        entity_b: entityB,
        axes_evidence: axesEvidence,
        summary_text: summary,
      });
    } catch (wErr) {
      if (wErr instanceof WriteError) {
        recorder.tool({ toolName: "writeClusterSuggestion", scopedTenantId: tenantId, outcome: "refused", refusalReason: wErr.code });
        await recorder.finish({ status: "refused" });
        return jsonResponse(422, { ok: false, code: wErr.code, message: wErr.message, debug_trace_id: recorder.traceId });
      }
      throw wErr;
    }

    recorder.tool({
      toolName: "writeClusterSuggestion",
      scopedTenantId: tenantId,
      returnedObjectCount: 2,
      outcome: "ok",
    });
    await recorder.finish({ status: "ok" });

    return jsonResponse(200, {
      ok: true,
      debug_trace_id: recorder.traceId,
      cluster_id: writeResult.cluster_id,
      member_anchor_id: writeResult.member_anchor_id,
      member_candidate_id: writeResult.member_candidate_id,
      axes_evidence: axesEvidence,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recorder.tool({ toolName: "er_compare", scopedTenantId: tenantId, outcome: "error", refusalReason: msg });
    await recorder.finish({ status: "error" });
    return jsonResponse(500, { ok: false, code: "internal_error", message: msg, debug_trace_id: recorder.traceId });
  }
});
