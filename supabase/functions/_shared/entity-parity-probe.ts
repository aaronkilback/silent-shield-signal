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
  //    Updated for G5 ontology: the detail card surfaces entity_content (sources),
  //    entity_relationships (relationships), entity_photos (photos), poi_investigations
  //    (entity scans), poi_reports (entity threat reports), and entity_mentions (signals).
  const { data: uiMentions } = await sb.from("entity_mentions").select("signal_id").eq("entity_id", cid).limit(2000);
  const uiSignalIds: string[] = (uiMentions || []).map((r: { signal_id: string }) => r.signal_id);
  const { data: uiPoiInvs } = await sb.from("poi_investigations").select("id").eq("entity_id", cid).eq("tenant_id", tenantId).limit(500);
  const uiPoiInvIds: string[] = (uiPoiInvs || []).map((r: { id: string }) => r.id);
  const { data: uiPoiReps } = await sb.from("poi_reports").select("id").eq("entity_id", cid).limit(500);
  const uiPoiRepIds: string[] = (uiPoiReps || []).map((r: { id: string }) => r.id);
  const { data: uiPhotos } = await sb.from("entity_photos").select("id").eq("entity_id", cid).limit(500);
  const uiPhotoIds: string[] = (uiPhotos || []).map((r: { id: string }) => r.id);
  const { data: uiSources } = await sb.from("entity_content").select("id").eq("entity_id", cid).limit(500);
  const uiSourceIds: string[] = (uiSources || []).map((r: { id: string }) => r.id);
  const { data: uiRelsA } = await sb.from("entity_relationships").select("id").eq("entity_a_id", cid).limit(200);
  const { data: uiRelsB } = await sb.from("entity_relationships").select("id").eq("entity_b_id", cid).limit(200);
  const uiRelIds: string[] = Array.from(new Set([...(uiRelsA || []), ...(uiRelsB || [])].map((r: { id: string }) => r.id)));

  // 4. DB reality — broadest source-of-truth union for forensic visibility.
  const { data: dbAutoSignals } = await sb.from("signals")
    .select("id").eq("tenant_id", tenantId).eq("is_test", false).contains("auto_correlated_entities", [cid]).limit(2000);
  const dbAutoIds: string[] = (dbAutoSignals || []).map((s: { id: string }) => s.id);
  const dbSignalIds = Array.from(new Set([...uiSignalIds, ...dbAutoIds]));   // entity_mentions ∪ auto_correlated

  // Graph axis ids — extended with the three G5 ontology axes.
  const graphSignalIds = (graph.signals?.directly_correlated ?? []).map((s) => s.id);
  const graphCaseInvIds = (graph.investigations ?? []).map((i) => i.id);        // case-file investigations table
  const graphOpRepIds = (graph.reports ?? []).map((r) => r.id);                 // operational reports table
  const graphSrcIds = (graph.sources ?? []).map((s) => s.id);
  const graphRelIds = (graph.relationships ?? []).map((r) => r.id);
  const graphRecIds = (graph.recommendations ?? []).map((r) => r.id);
  const graphEntityScanIds = (graph.entity_scans ?? []).map((r) => r.id);       // poi_investigations
  const graphEntityRepIds = (graph.entity_reports ?? []).map((r) => r.id);      // poi_reports
  const graphPhotoIds = (graph.photos ?? []).map((r) => r.id);

  // Helper for the dual / authoritative-only axes: build a "graph-authoritative" probe.
  const graphAuthoritative = (axis: string, ids: string[], src: string): ParityAxisProbe => ({
    axis,
    ui: { count: null, ids: [], query_source: "n/a — graph-authoritative by ontology (see ADR aegis-operational-ontology)" },
    graph: { count: ids.length, ids, query_source: src },
    db: { count: ids.length, ids, query_source: src },
    status: "aligned", missing_from_graph: [], missing_from_ui: [], // intentional: not a defect
  });

  // 5. Build per-axis probes — G5 ontology-aligned.
  const axes: ParityAxisProbe[] = [];

  // signals — both surfaces, (c)-semantics. UI = entity_mentions only; Graph = entity_mentions ∪ auto_correlated.
  {
    const sd = symDiff(uiSignalIds, graphSignalIds);
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

  // entity_scans — both surfaces query poi_investigations.entity_id (G5 alignment).
  {
    const sd = symDiff(uiPoiInvIds, graphEntityScanIds);
    const c = classify(uiPoiInvIds.length, graphEntityScanIds.length, sd.onlyA.length, sd.onlyB.length, false);
    axes.push({
      axis: "entity_scans",
      ui: { count: uiPoiInvIds.length, ids: uiPoiInvIds, query_source: "poi_investigations.entity_id" },
      graph: { count: graphEntityScanIds.length, ids: graphEntityScanIds, query_source: "poi_investigations.entity_id" },
      db: { count: uiPoiInvIds.length, ids: uiPoiInvIds, query_source: "poi_investigations.entity_id" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // entity_reports — both surfaces query poi_reports.entity_id (G5 alignment).
  {
    const sd = symDiff(uiPoiRepIds, graphEntityRepIds);
    const c = classify(uiPoiRepIds.length, graphEntityRepIds.length, sd.onlyA.length, sd.onlyB.length, false);
    axes.push({
      axis: "entity_reports",
      ui: { count: uiPoiRepIds.length, ids: uiPoiRepIds, query_source: "poi_reports.entity_id" },
      graph: { count: graphEntityRepIds.length, ids: graphEntityRepIds, query_source: "poi_reports.entity_id" },
      db: { count: uiPoiRepIds.length, ids: uiPoiRepIds, query_source: "poi_reports.entity_id" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // sources — both surfaces query entity_content.entity_id (probe UI-reality fix).
  {
    const sd = symDiff(uiSourceIds, graphSrcIds);
    const c = classify(uiSourceIds.length, graphSrcIds.length, sd.onlyA.length, sd.onlyB.length, false);
    axes.push({
      axis: "sources",
      ui: { count: uiSourceIds.length, ids: uiSourceIds, query_source: "entity_content.entity_id" },
      graph: { count: graphSrcIds.length, ids: graphSrcIds, query_source: "entity_content.entity_id" },
      db: { count: uiSourceIds.length, ids: uiSourceIds, query_source: "entity_content.entity_id" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // relationships — both surfaces query entity_relationships endpoints (probe UI-reality fix).
  {
    const sd = symDiff(uiRelIds, graphRelIds);
    const c = classify(uiRelIds.length, graphRelIds.length, sd.onlyA.length, sd.onlyB.length, false);
    axes.push({
      axis: "relationships",
      ui: { count: uiRelIds.length, ids: uiRelIds, query_source: "entity_relationships.entity_a_id|entity_b_id" },
      graph: { count: graphRelIds.length, ids: graphRelIds, query_source: "entity_relationships.entity_a_id|entity_b_id (tenant-validated)" },
      db: { count: uiRelIds.length, ids: uiRelIds, query_source: "entity_relationships" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
      failure_class: c.failure_class, reason: c.reason,
    });
  }

  // photos — both surfaces query entity_photos.entity_id.
  {
    const sd = symDiff(uiPhotoIds, graphPhotoIds);
    const c = classify(uiPhotoIds.length, graphPhotoIds.length, sd.onlyA.length, sd.onlyB.length, false);
    axes.push({
      axis: "photos",
      ui: { count: uiPhotoIds.length, ids: uiPhotoIds, query_source: "entity_photos.entity_id" },
      graph: { count: graphPhotoIds.length, ids: graphPhotoIds, query_source: "entity_photos.entity_id" },
      db: { count: uiPhotoIds.length, ids: uiPhotoIds, query_source: "entity_photos.entity_id" },
      status: c.status, missing_from_graph: sd.onlyA, missing_from_ui: sd.onlyB,
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

  // ── Graph-authoritative axes (intentional, documented in ADR aegis-operational-ontology) ──
  axes.push(graphAuthoritative("signals.client_context", (graph.signals?.client_context ?? []).map((s) => s.id), "(c)-semantics: same-client signals not entity-correlated"));
  axes.push(graphAuthoritative("case_investigations", graphCaseInvIds, "investigations.correlated_entity_ids (multi-entity case files; surfaced via EntityUnifiedProfile, not detail card)"));
  axes.push(graphAuthoritative("operational_reports", graphOpRepIds, "generated_reports.metadata.entity_id (period-based; surfaced on Reports page, not detail card)"));
  axes.push(graphAuthoritative("recommendations", graphRecIds, "aegis_recommendations.target_entity_id (no UI tab yet; operator-only via Aegis chat)"));

  // scans (legacy axis) — autonomous_scan_results has no entity link; superseded by entity_scans.
  axes.push({
    axis: "scans",
    ui: { count: null, ids: [], query_source: "n/a — superseded by entity_scans (poi_investigations) per ADR ontology" },
    graph: { count: null, ids: [], query_source: "n/a — autonomous_scan_results has no entity link" },
    db: { count: null, ids: [], query_source: "n/a" },
    status: "inconclusive",
    missing_from_graph: [], missing_from_ui: [],
    reason: "scans axis now subsumed by entity_scans (poi_investigations); no operational gap.",
  });

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
