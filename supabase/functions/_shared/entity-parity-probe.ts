// G4 — Aegis Entity Parity Oracle (executable acceptance contract).
// Compares THREE realities per axis: UI · Aegis-Graph · DB, and classifies any divergence.
// Code-only, no schema mutation, no canonicalization writes. The probe is the contract that
// will gate any G3 schema/backfill work.
//
// ADR: docs/.../aegis-canonical-entity-and-unified-graph.md §4.

import { entityGraph, resolveCanonicalEntity, type CanonicalClassification, type EntityGraph } from "./tenant-entity-graph.ts";
import type { Recorder } from "./flight-recorder.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type ParityStatus =
  | "aligned"               // UI ≈ Graph (counts + ids match)
  | "count_diff"            // both populated; counts differ
  | "graph_missing"         // UI has rows; Graph does not (Aegis blind spot)
  | "ui_missing"            // Graph has rows; UI does not surface them (graph-only axis)
  | "definition_diverged"   // UI and Graph query DIFFERENT tables for the same axis
  | "inconclusive";         // canonicalization blockers / not-found / data error

export type FailureClass = "retrieval" | "edge" | "ui" | "canonicalization" | "data_model";

export interface ParityAxisProbe {
  axis: string;
  ui: { count: number | null; ids: string[]; query_source: string };
  graph: { count: number | null; ids: string[]; query_source: string };
  db: { count: number | null; ids: string[]; query_source: string };
  status: ParityStatus;
  missing_from_graph: string[];
  missing_from_ui: string[];
  failure_class?: FailureClass;
  reason?: string;
}

export interface ParityProbeResult {
  ref: string;
  tenant_id: string;
  canonical: { id: string; name: string } | null;
  cluster: { id: string; name: string; type: string }[];
  classification: CanonicalClassification;
  blockers: string[];
  axes: ParityAxisProbe[];
  passed: boolean;
  failure_classes: FailureClass[];
  generated_at: string;
}

function symDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const A = new Set(a); const B = new Set(b);
  return { onlyA: a.filter((x) => !B.has(x)), onlyB: b.filter((x) => !A.has(x)) };
}

function classify(uiCount: number | null, graphCount: number | null, missingFromGraph: number, missingFromUi: number, definitionDiverged: boolean): { status: ParityStatus; failure_class?: FailureClass; reason?: string } {
  if (definitionDiverged) {
    return { status: "definition_diverged", failure_class: "data_model", reason: "UI and Graph query different tables for the same axis." };
  }
  if (uiCount === null && graphCount !== null) {
    return { status: "ui_missing", failure_class: "ui", reason: "UI does not surface this axis; Graph-only." };
  }
  if (uiCount !== null && graphCount === null) {
    return { status: "graph_missing", failure_class: "retrieval", reason: "UI shows rows; Graph does not retrieve them." };
  }
  if (uiCount === graphCount && missingFromGraph === 0 && missingFromUi === 0) {
    return { status: "aligned" };
  }
  return {
    status: "count_diff",
    failure_class: "retrieval",
    reason: `count_diff: ui=${uiCount} graph=${graphCount} missing_from_graph=${missingFromGraph} missing_from_ui=${missingFromUi}`,
  };
}

/**
 * The acceptance contract.
 * Compares UI reality (queries the entity card actually runs) vs Aegis Graph reality
 * (entityGraph output) vs DB reality (the union source-of-truth). Reports per-axis
 * status + classifies divergences. No mutation; safe to run on prod.
 */
export async function entityParityProbe(
  sb: SB,
  tenantId: string,
  ref: string,
  rec?: Recorder,
): Promise<ParityProbeResult> {
  const generated_at = new Date().toISOString();

  // 1. Canonical resolution + cluster.
  const resolution = await resolveCanonicalEntity(sb, tenantId, ref, rec);
  if (!resolution.canonical) {
    // No usable canonical — every axis is inconclusive; canonicalization-class failure.
    const axes: ParityAxisProbe[] = ["signals", "investigations", "reports", "sources", "relationships", "recommendations", "monitoring_state", "photos"].map((axis) => ({
      axis,
      ui: { count: null, ids: [], query_source: "n/a" },
      graph: { count: null, ids: [], query_source: "n/a" },
      db: { count: null, ids: [], query_source: "n/a" },
      status: "inconclusive" as ParityStatus,
      missing_from_graph: [], missing_from_ui: [],
      failure_class: "canonicalization" as FailureClass,
      reason: `no usable canonical — classification=${resolution.classification} blockers=${resolution.blockers.join(",") || "n/a"}`,
    }));
    return {
      ref, tenant_id: tenantId, canonical: null,
      cluster: resolution.cluster.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      classification: resolution.classification, blockers: resolution.blockers,
      axes, passed: false, failure_classes: ["canonicalization"], generated_at,
    };
  }
  const cid = resolution.canonical.id;
  const cluster = resolution.cluster.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  // 2. Aegis Graph reality.
  const graph: EntityGraph = await entityGraph(sb, tenantId, cid, rec);

  // 3. UI reality — exact queries from src/components/EntityDetailDialog.tsx.
  const { data: uiMentions } = await sb.from("entity_mentions").select("signal_id").eq("entity_id", cid).limit(2000);
  const uiSignalIds: string[] = (uiMentions || []).map((r: { signal_id: string }) => r.signal_id);
  const { data: uiInvs } = await sb.from("poi_investigations").select("id").eq("entity_id", cid).eq("tenant_id", tenantId).limit(500);
  const uiInvIds: string[] = (uiInvs || []).map((r: { id: string }) => r.id);
  const { data: uiReps } = await sb.from("poi_reports").select("id").eq("entity_id", cid).limit(500);
  const uiRepIds: string[] = (uiReps || []).map((r: { id: string }) => r.id);
  const { data: uiPhotos } = await sb.from("entity_photos").select("id").eq("entity_id", cid).limit(500);
  const uiPhotoIds: string[] = (uiPhotos || []).map((r: { id: string }) => r.id);

  // 4. DB reality — broadest source-of-truth (Graph ∪ UI sources where applicable).
  const { data: dbAutoSignals } = await sb.from("signals")
    .select("id").eq("tenant_id", tenantId).eq("is_test", false).contains("auto_correlated_entities", [cid]).limit(2000);
  const dbAutoIds: string[] = (dbAutoSignals || []).map((s: { id: string }) => s.id);
  const dbSignalIds = Array.from(new Set([...uiSignalIds, ...dbAutoIds]));   // union: entity_mentions ∪ auto_correlated

  const { data: dbInvBroad } = await sb.from("investigations").select("id, client_id").contains("correlated_entity_ids", [cid]).limit(500);
  const { data: tenantClients } = await sb.from("clients").select("id").eq("tenant_id", tenantId);
  const tenantClientSet = new Set((tenantClients || []).map((c: { id: string }) => c.id));
  const dbInvBroadInTenant: string[] = (dbInvBroad || []).filter((r: { client_id: string }) => tenantClientSet.has(r.client_id)).map((r: { id: string }) => r.id);
  const dbInvIds = Array.from(new Set([...uiInvIds, ...dbInvBroadInTenant])); // union: poi_investigations ∪ investigations

  const { data: dbGenReports } = await sb.from("generated_reports").select("id").eq("tenant_id", tenantId).filter("metadata->>entity_id", "eq", cid).limit(500);
  const dbGenRepIds: string[] = (dbGenReports || []).map((r: { id: string }) => r.id);
  const dbReportIds = Array.from(new Set([...uiRepIds, ...dbGenRepIds]));     // union: poi_reports ∪ generated_reports

  // Graph axis ids.
  const graphSignalIds = (graph.signals?.directly_correlated ?? []).map((s) => s.id);
  const graphInvIds = (graph.investigations ?? []).map((i) => i.id);
  const graphRepIds = (graph.reports ?? []).map((r) => r.id);
  const graphSrcIds = (graph.sources ?? []).map((s) => s.id);
  const graphRelIds = (graph.relationships ?? []).map((r) => r.id);
  const graphRecIds = (graph.recommendations ?? []).map((r) => r.id);

  // 5. Build per-axis probes.
  const axes: ParityAxisProbe[] = [];

  // signals (axis where UI + Graph use the SAME backing tables, modulo auto_correlated)
  {
    const sd = symDiff(uiSignalIds, graphSignalIds);
    // Graph adds auto_correlated_entities the UI doesn't capture → ui_missing rather than count_diff.
    const c = classify(uiSignalIds.length, graphSignalIds.length, sd.onlyA.length, sd.onlyB.length, false);
    axes.push({
      axis: "signals",
      ui: { count: uiSignalIds.length, ids: uiSignalIds, query_source: "entity_mentions.entity_id" },
      graph: { count: graphSignalIds.length, ids: graphSignalIds, query_source: "entity_mentions ∪ signals.auto_correlated_entities" },
      db: { count: dbSignalIds.length, ids: dbSignalIds, query_source: "entity_mentions ∪ auto_correlated_entities" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // investigations — definition divergence (UI: poi_investigations; Graph: investigations).
  {
    const definitionDiverged = true; // different tables
    const sd = symDiff(uiInvIds, graphInvIds);
    const c = classify(uiInvIds.length, graphInvIds.length, sd.onlyA.length, sd.onlyB.length, definitionDiverged);
    axes.push({
      axis: "investigations",
      ui: { count: uiInvIds.length, ids: uiInvIds, query_source: "poi_investigations.entity_id" },
      graph: { count: graphInvIds.length, ids: graphInvIds, query_source: "investigations.correlated_entity_ids" },
      db: { count: dbInvIds.length, ids: dbInvIds, query_source: "poi_investigations ∪ investigations" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // reports — definition divergence (UI: poi_reports; Graph: generated_reports).
  {
    const definitionDiverged = true;
    const sd = symDiff(uiRepIds, graphRepIds);
    const c = classify(uiRepIds.length, graphRepIds.length, sd.onlyA.length, sd.onlyB.length, definitionDiverged);
    axes.push({
      axis: "reports",
      ui: { count: uiRepIds.length, ids: uiRepIds, query_source: "poi_reports.entity_id" },
      graph: { count: graphRepIds.length, ids: graphRepIds, query_source: "generated_reports.metadata.entity_id" },
      db: { count: dbReportIds.length, ids: dbReportIds, query_source: "poi_reports ∪ generated_reports" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // sources — Graph-only (UI doesn't surface entity_content on the detail card).
  {
    const c = classify(null, graphSrcIds.length, 0, 0, false);
    axes.push({
      axis: "sources",
      ui: { count: null, ids: [], query_source: "n/a — UI does not show entity_content on detail card" },
      graph: { count: graphSrcIds.length, ids: graphSrcIds, query_source: "entity_content.entity_id" },
      db: { count: graphSrcIds.length, ids: graphSrcIds, query_source: "entity_content.entity_id" },
      status: c.status, missing_from_graph: [], missing_from_ui: graphSrcIds,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // scans — not directly linkable v1 (per ADR + graph note).
  axes.push({
    axis: "scans",
    ui: { count: null, ids: [], query_source: "n/a" },
    graph: { count: null, ids: [], query_source: "n/a (autonomous_scan_results has no entity link)" },
    db: { count: null, ids: [], query_source: "n/a" },
    status: "inconclusive",
    missing_from_graph: [], missing_from_ui: [],
    failure_class: "data_model",
    reason: "scans not directly linkable in v1 — investigate-poi findings flow into entity_content instead.",
  });

  // relationships — Graph-only.
  {
    const c = classify(null, graphRelIds.length, 0, 0, false);
    axes.push({
      axis: "relationships",
      ui: { count: null, ids: [], query_source: "n/a — UI does not show entity_relationships on detail card" },
      graph: { count: graphRelIds.length, ids: graphRelIds, query_source: "entity_relationships.entity_a_id|entity_b_id" },
      db: { count: graphRelIds.length, ids: graphRelIds, query_source: "entity_relationships" },
      status: c.status, missing_from_graph: [], missing_from_ui: graphRelIds,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // recommendations — Graph-only (aegis_recommendations target_entity_id).
  {
    const c = classify(null, graphRecIds.length, 0, 0, false);
    axes.push({
      axis: "recommendations",
      ui: { count: null, ids: [], query_source: "n/a — UI does not show aegis_recommendations on detail card" },
      graph: { count: graphRecIds.length, ids: graphRecIds, query_source: "aegis_recommendations.target_entity_id" },
      db: { count: graphRecIds.length, ids: graphRecIds, query_source: "aegis_recommendations" },
      status: c.status, missing_from_graph: [], missing_from_ui: graphRecIds,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // monitoring_state — boolean comparison.
  {
    const uiActive = !!resolution.canonical.active_monitoring_enabled;
    const graphActive = !!graph.monitoring_state?.active;
    const aligned = uiActive === graphActive;
    axes.push({
      axis: "monitoring_state",
      ui: { count: uiActive ? 1 : 0, ids: uiActive ? [cid] : [], query_source: "entities.active_monitoring_enabled" },
      graph: { count: graphActive ? 1 : 0, ids: graphActive ? [cid] : [], query_source: "entities.active_monitoring_enabled" },
      db: { count: uiActive ? 1 : 0, ids: uiActive ? [cid] : [], query_source: "entities.active_monitoring_enabled" },
      status: aligned ? "aligned" : "count_diff",
      missing_from_graph: [], missing_from_ui: [],
      failure_class: aligned ? undefined : "retrieval",
    });
  }

  // photos — UI-only (Graph doesn't surface entity_photos).
  {
    const c = classify(uiPhotoIds.length, null, 0, 0, false);
    axes.push({
      axis: "photos",
      ui: { count: uiPhotoIds.length, ids: uiPhotoIds, query_source: "entity_photos.entity_id" },
      graph: { count: null, ids: [], query_source: "n/a — entityGraph does not include photos in v1" },
      db: { count: uiPhotoIds.length, ids: uiPhotoIds, query_source: "entity_photos.entity_id" },
      status: c.status, missing_from_graph: uiPhotoIds, missing_from_ui: [],
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // 6. Overall pass/fail + failure-class summary.
  const failureClasses = new Set<FailureClass>();
  for (const a of axes) if (a.failure_class) failureClasses.add(a.failure_class);
  const passed = [...failureClasses].length === 0;

  return {
    ref, tenant_id: tenantId,
    canonical: { id: cid, name: resolution.canonical.name },
    cluster, classification: resolution.classification, blockers: resolution.blockers,
    axes, passed, failure_classes: [...failureClasses], generated_at,
  };
}
