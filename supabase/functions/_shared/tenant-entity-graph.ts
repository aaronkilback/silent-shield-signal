// Aegis Unified Retrieval — certified tenant-scoped ENTITY intelligence graph.
//
// Implements docs/platform-operations/architecture-decisions/aegis-unified-retrieval-graph.md:
//   • scope seam: every node read is scoped to the caller's tenant (entities/signals
//     by tenant_id direct; entity_mentions parent-joined; entity_relationships edge-joined).
//   • deterministic traversal: one authoritative edge per pair, no fallback OR-soup.
//   • provenance trace: every result carries { surface, scope, edges, row_ids, counts }.
//   • (c) entity↔signal semantics: signals DIRECTLY CORRELATED to the entity
//     (entity_mentions ∪ signals.auto_correlated_entities) are reported SEPARATELY from
//     "signals in the entity's client context that are not yet entity-correlated".
//
// HARD RULES (ratified): no probabilistic name/title matching; no implicit linkage from
// shared client + title text; no fabricated edges; surface the integrity gap honestly.
//
// First certified slice = entity intelligence only. Correlation re-run/backfill is a
// separate future write-side task and is NOT performed here.

import type { Recorder } from "./flight-recorder.ts";

export interface Provenance {
  surface: string;          // certified node surface read
  scope: string;            // exact tenant scope applied
  edges: string[];          // canonical edges traversed (deterministic)
  row_ids?: string[];       // actual rows touched (reproducible provenance)
  counts?: Record<string, number>;
  note?: string;
}

// deno-lint-ignore no-explicit-any
type SB = any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireTenant(tenantId?: string): asserts tenantId is string {
  if (!tenantId) {
    throw new Error("TENANT_CONTEXT_MISSING: the entity intelligence graph requires an active tenant context.");
  }
}

/** Node surface: entities. Certified scope key = tenant_id (direct). */
export async function entityIntelligence(sb: SB, tenantId: string, opts: { type?: string } = {}) {
  requireTenant(tenantId);
  let q = sb
    .from("entities")
    .select("id, name, type, risk_level, threat_score, active_monitoring_enabled, visibility_class")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (opts.type) q = q.eq("type", opts.type);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const monitored = rows.filter((e: any) => e.active_monitoring_enabled === true);
  const unreviewed = rows.filter((e: any) => e.visibility_class === "extracted");
  const byType: Record<string, number> = {};
  for (const e of rows) byType[e.type] = (byType[e.type] || 0) + 1;
  return {
    total: rows.length,
    monitored_count: monitored.length,
    unreviewed_count: unreviewed.length,
    by_type: byType,
    monitored: monitored.map((e: any) => ({ id: e.id, name: e.name, type: e.type, threat_score: e.threat_score, risk_level: e.risk_level })),
    entities: rows.map((e: any) => ({ id: e.id, name: e.name, type: e.type, risk_level: e.risk_level, threat_score: e.threat_score })),
    provenance: {
      surface: "entities",
      scope: `entities.tenant_id = '${tenantId}' AND is_active = true`,
      edges: ["tenant→entities (direct tenant_id)"],
      counts: { total: rows.length, monitored: monitored.length, unreviewed: unreviewed.length },
    } as Provenance,
  };
}

/** Resolve an entity within the tenant by id or name (tenant-scoped). Returns matches. */
async function resolveEntity(sb: SB, tenantId: string, ref: string) {
  let q = sb
    .from("entities")
    .select("id, name, type, client_id, risk_level, threat_score, active_monitoring_enabled, visibility_class, description, current_location")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  q = UUID_RE.test(ref) ? q.eq("id", ref) : q.ilike("name", `%${ref}%`);
  const { data, error } = await q.limit(6);
  if (error) throw error;
  return data ?? [];
}

export async function entityDetails(sb: SB, tenantId: string, ref: string) {
  requireTenant(tenantId);
  const matches = await resolveEntity(sb, tenantId, ref);
  return {
    matches,
    provenance: {
      surface: "entities",
      scope: `entities.tenant_id = '${tenantId}'`,
      edges: ["tenant→entities (direct)"],
      row_ids: matches.map((e: any) => e.id),
      note: matches.length === 0 ? "no matching entity in this tenant" : undefined,
    } as Provenance,
  };
}

/**
 * (c) entity↔signal. Correlated edge = entity_mentions ∪ signals.auto_correlated_entities.
 * Uncorrelated client-context = signals for the entity's client NOT in the correlated set.
 * Both tenant-scoped. NO name/title inference.
 */
export async function entitySignals(sb: SB, tenantId: string, ref: string) {
  requireTenant(tenantId);
  const matches = await resolveEntity(sb, tenantId, ref);
  if (matches.length === 0) {
    return {
      resolved: null, correlated_count: 0, correlated: [], client_context_uncorrelated_count: 0, client_context_uncorrelated: [],
      provenance: { surface: "entities", scope: `tenant_id='${tenantId}'`, edges: [], note: `no entity matching "${ref}" in this tenant` } as Provenance,
    };
  }
  if (matches.length > 1) {
    return {
      resolved: null, ambiguous: matches.map((e: any) => ({ id: e.id, name: e.name, type: e.type })),
      correlated_count: 0, correlated: [], client_context_uncorrelated_count: 0, client_context_uncorrelated: [],
      provenance: { surface: "entities", scope: `tenant_id='${tenantId}'`, edges: ["tenant→entities"], note: `${matches.length} entities match "${ref}" — specify which (no guessing).` } as Provenance,
    };
  }
  const entity = matches[0];
  const eid = entity.id;

  // Correlated edge 1 — entity_mentions junction (entity already proven in-tenant).
  const { data: mentions } = await sb.from("entity_mentions").select("signal_id").eq("entity_id", eid);
  const mentionIds = (mentions ?? []).map((m: any) => m.signal_id).filter(Boolean);

  // Correlated edge 2 — signals.auto_correlated_entities array contains the entity id (tenant-scoped).
  const { data: arr } = await sb.from("signals").select("id").eq("tenant_id", tenantId).contains("auto_correlated_entities", [eid]);
  const arrIds = (arr ?? []).map((s: any) => s.id);

  const correlatedIds = Array.from(new Set<string>([...mentionIds, ...arrIds]));

  let correlated: any[] = [];
  if (correlatedIds.length > 0) {
    const { data } = await sb.from("signals")
      .select("id, title, severity, status, category, received_at")
      .eq("tenant_id", tenantId)            // defense-in-depth: only this tenant's signals
      .in("id", correlatedIds)
      .order("received_at", { ascending: false })
      .limit(50);
    correlated = data ?? [];
  }

  // Uncorrelated client-context signals: the entity's client, tenant-scoped, minus correlated.
  let clientUncorrelated: any[] = [];
  let clientUncorrelatedCount = 0;
  if (entity.client_id) {
    let q = sb.from("signals")
      .select("id, title, severity, status, category, received_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("client_id", entity.client_id);
    if (correlatedIds.length > 0) q = q.not("id", "in", `(${correlatedIds.join(",")})`);
    const { data, count } = await q.order("received_at", { ascending: false }).limit(50);
    clientUncorrelated = data ?? [];
    clientUncorrelatedCount = count ?? clientUncorrelated.length;
  }

  return {
    resolved: { id: eid, name: entity.name, type: entity.type, client_id: entity.client_id },
    correlated_count: correlatedIds.length,
    correlated,
    client_context_uncorrelated_count: clientUncorrelatedCount,
    client_context_uncorrelated: clientUncorrelated,
    provenance: {
      surface: "signals",
      scope: `signals.tenant_id = '${tenantId}'`,
      edges: [
        "entity→signals (entity_mentions junction)",
        "entity→signals (signals.auto_correlated_entities array)",
        "entity→client→signals (client_id, EXCLUDING correlated — reported as uncorrelated context)",
      ],
      row_ids: correlatedIds,
      counts: { correlated: correlatedIds.length, client_context_uncorrelated: clientUncorrelatedCount },
      note: "(c) semantics: directly-correlated signals are distinct from uncorrelated client-context signals. No name/title inference; no fabricated edges.",
    } as Provenance,
  };
}

/** entity_relationships — edge-join; only edges with BOTH endpoints in-tenant are returned. */
export async function entityRelationships(sb: SB, tenantId: string, ref: string) {
  requireTenant(tenantId);
  const matches = await resolveEntity(sb, tenantId, ref);
  if (matches.length !== 1) {
    return {
      relationships: [],
      provenance: { surface: "entity_relationships", scope: `tenant_id='${tenantId}'`, edges: [], note: matches.length === 0 ? `no entity matching "${ref}"` : `ambiguous match for "${ref}" — specify which.` } as Provenance,
    };
  }
  const eid = matches[0].id;
  const { data: tenantEntities } = await sb.from("entities").select("id, name").eq("tenant_id", tenantId);
  const nameById = new Map<string, string>((tenantEntities ?? []).map((e: any) => [e.id, e.name]));
  const { data: rels } = await sb.from("entity_relationships")
    .select("entity_a_id, entity_b_id, relationship_type, strength, last_observed")
    .or(`entity_a_id.eq.${eid},entity_b_id.eq.${eid}`);
  // Edge-join scope: BOTH endpoints must be in-tenant entities (no cross-tenant edge).
  const safe = (rels ?? []).filter((r: any) => nameById.has(r.entity_a_id) && nameById.has(r.entity_b_id));
  return {
    entity: { id: eid, name: matches[0].name },
    relationships: safe.map((r: any) => ({
      a: nameById.get(r.entity_a_id), b: nameById.get(r.entity_b_id),
      type: r.relationship_type, strength: r.strength, last_observed: r.last_observed,
    })),
    provenance: {
      surface: "entity_relationships",
      scope: `both endpoints ∈ entities.tenant_id = '${tenantId}'`,
      edges: ["entity↔entity (entity_relationships edge-join, both endpoints in-tenant)"],
      counts: { relationships: safe.length, dropped_cross_tenant: (rels ?? []).length - safe.length },
    } as Provenance,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// G2 — Canonical resolution + unified graph traversal (code-only, no mutation).
// Implements docs/.../aegis-canonical-entity-and-unified-graph.md.
// HARD RULE (ratified clarification, 2026-05-28):
//   "Same normalized name ≠ same entity." Candidates form a CLUSTER; collapse
//   only when ALL six preconditions hold (same tenant · compatible type · no
//   protected-principal / placeholder conflict · no source-of-truth conflict ·
//   operator override available · provenance recorded). G2 IDENTIFIES + RESOLVES
//   SAFELY — never writes canonical_entity_id, never auto-collapses, never mutates.
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalClassification =
  | "singleton"
  | "safe_to_collapse"
  | "unresolved_conflict"
  | "pending_operator_review";

export interface CanonicalEntity {
  id: string;
  name: string;
  type: string;
  tenant_id: string;
  client_id: string | null;
  risk_level: string | null;
  threat_score: number | null;
  active_monitoring_enabled: boolean | null;
  attributes: Record<string, unknown> | null;
  visibility_class: string | null;
  created_at: string;
}

export interface CanonicalResolution {
  canonical: CanonicalEntity | null;
  cluster: CanonicalEntity[];
  classification: CanonicalClassification;
  blockers: string[];
  provenance: { input_ref: string; matched_by: "id" | "name_exact" | "not_found"; rules_applied: string[] };
}

const CANONICAL_SELECT =
  "id, name, type, tenant_id, client_id, risk_level, threat_score, active_monitoring_enabled, attributes, visibility_class, created_at";

const normName = (s: string): string => s.toLowerCase().trim();

/**
 * Conservative canonical resolution — ADR §1a.
 * Tenant-scoped + fail-closed (no tenant → unresolved). Reads only; no mutation.
 */
export async function resolveCanonicalEntity(
  sb: SB,
  tenantId: string,
  ref: string,
  rec?: Recorder,
): Promise<CanonicalResolution> {
  const t0 = Date.now();
  if (!tenantId || !ref) {
    return {
      canonical: null, cluster: [], classification: "unresolved_conflict",
      blockers: ["no_tenant_or_ref"],
      provenance: { input_ref: ref ?? "", matched_by: "not_found", rules_applied: [] },
    };
  }

  // 1. Seed by id-or-name (tenant-scoped at every step).
  let seed: CanonicalEntity | null = null;
  let matchedBy: "id" | "name_exact" | "not_found" = "not_found";
  if (UUID_RE.test(ref)) {
    const { data } = await sb.from("entities").select(CANONICAL_SELECT)
      .eq("tenant_id", tenantId).eq("id", ref).eq("is_active", true).maybeSingle();
    if (data) { seed = data as CanonicalEntity; matchedBy = "id"; }
  }
  if (!seed) {
    const { data } = await sb.from("entities").select(CANONICAL_SELECT)
      .eq("tenant_id", tenantId).eq("is_active", true).ilike("name", ref).limit(1).maybeSingle();
    if (data) { seed = data as CanonicalEntity; matchedBy = "name_exact"; }
  }
  if (!seed) {
    rec?.retrieval({
      surface: "resolveCanonicalEntity", query: ref, tenantScope: tenantId,
      returnedObjectIds: [], fallbackPath: "none", timingMs: Date.now() - t0,
      provenance: { matched_by: "not_found", input_ref: ref },
    });
    return {
      canonical: null, cluster: [], classification: "unresolved_conflict",
      blockers: ["not_found"],
      provenance: { input_ref: ref, matched_by: "not_found", rules_applied: [] },
    };
  }

  // 2. Find sibling rows in the same tenant sharing the normalized name (the CANDIDATE cluster).
  const norm = normName(seed.name);
  const { data: tenantRows } = await sb.from("entities").select(CANONICAL_SELECT)
    .eq("tenant_id", tenantId).eq("is_active", true);
  const cluster: CanonicalEntity[] = (tenantRows || []).filter(
    (e: CanonicalEntity) => normName(e.name) === norm,
  );

  // 3. Singleton early-exit.
  const rules: string[] = ["same_tenant"];
  if (cluster.length <= 1) {
    rec?.retrieval({
      surface: "resolveCanonicalEntity", query: ref, tenantScope: tenantId,
      returnedObjectIds: cluster.map(c => c.id),
      fallbackPath: "none", timingMs: Date.now() - t0,
      provenance: { matched_by: matchedBy, classification: "singleton", rules_applied: rules },
    });
    return {
      canonical: seed, cluster, classification: "singleton", blockers: [],
      provenance: { input_ref: ref, matched_by: matchedBy, rules_applied: rules },
    };
  }

  // 4. Apply the six conservative preconditions (ADR §1a). Any failure → unresolved.
  const blockers: string[] = [];

  rules.push("compatible_type");
  if (new Set(cluster.map(e => e.type)).size > 1) blockers.push("type_mismatch");

  rules.push("no_protected_principal");
  if (cluster.some(e => ((e.attributes ?? {}) as Record<string, unknown>).protected_principal === true || e.risk_level === "critical")) {
    blockers.push("protected_principal");
  }

  rules.push("no_placeholder_conflict");
  if (cluster.some(e => {
    const a = (e.attributes ?? {}) as Record<string, unknown>;
    return a.is_placeholder === true || a.placeholder_source !== undefined || e.visibility_class === "extracted";
  })) {
    blockers.push("placeholder_conflict");
  }

  rules.push("no_source_of_truth_conflict");
  const externals = new Set<string>();
  for (const e of cluster) {
    const a = (e.attributes ?? {}) as Record<string, unknown>;
    const x = a.external_id ?? a.canonical_source;
    if (typeof x === "string" && x.length > 0) externals.add(x);
  }
  if (externals.size > 1) blockers.push("source_of_truth_conflict");

  rules.push("operator_override_unavailable_v1"); // G3 surface — none yet.

  // 5. Classify.
  let classification: CanonicalClassification;
  let canonical: CanonicalEntity | null;
  if (blockers.length === 0) {
    classification = "safe_to_collapse";
    canonical = cluster.slice().sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )[0];
  } else {
    classification = "unresolved_conflict";
    canonical = null;
  }

  rec?.retrieval({
    surface: "resolveCanonicalEntity", query: ref, tenantScope: tenantId,
    returnedObjectIds: cluster.map(c => c.id),
    fallbackPath: "none", timingMs: Date.now() - t0,
    provenance: { matched_by: matchedBy, classification, blockers, rules_applied: rules, cluster_size: cluster.length },
  });

  return {
    canonical, cluster, classification, blockers,
    provenance: { input_ref: ref, matched_by: matchedBy, rules_applied: rules },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// entityGraph — the unified traversal seam (ADR §2). 8 axes, tenant-scoped,
// per-axis flight-recorder retrieval traces, deterministic provenance.
// Calls resolveCanonicalEntity first; returns early without traversal when no
// safe canonical exists (Aegis must then present "multiple candidates — operator
// must elect" rather than silently picking one).
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityGraphSignals {
  directly_correlated: { id: string; title: string; created_at: string }[];
  client_context: { id: string; title: string; created_at: string }[];
}

export interface EntityGraphRelationship {
  id: string;
  relationship_type: string;
  strength: number | null;
  other: { id: string; name: string; type: string };
}

export interface EntityGraph {
  canonical: CanonicalEntity | null;
  cluster: CanonicalEntity[];
  classification: CanonicalClassification;
  blockers: string[];
  signals?: EntityGraphSignals;
  // case-file investigations (multi-entity narrative files; surfaced in EntityUnifiedProfile, not the detail card).
  investigations?: { id: string; file_number: string | null; synopsis: string | null; created_at: string }[];
  // operator-period operational reports (multi-entity); surfaced on the separate Reports page, NOT the entity card.
  reports?: { id: string; report_type: string; title: string; created_at: string }[];
  sources?: { id: string; content_type: string; source: string | null; title: string | null; url: string | null; created_at: string }[];
  relationships?: EntityGraphRelationship[];
  recommendations?: { id: string; kind: string; title: string; status: string; created_at: string }[];
  monitoring_state?: { active: boolean; context: string | null };
  // ── G5 ontology — entity-targeted concepts surfaced on EntityDetailDialog ──
  entity_scans?: { id: string; status: string | null; created_at: string }[];        // poi_investigations
  entity_reports?: { id: string; threat_level: string | null; confidence_score: number | null; created_at: string }[]; // poi_reports
  photos?: { id: string; storage_path: string | null; source: string | null; created_at: string }[]; // entity_photos
  scans?: { note: string };           // legacy field — autonomous_scan_results axis, now subsumed by entity_scans
  provenance: Provenance[];
}

export async function entityGraph(
  sb: SB,
  tenantId: string,
  ref: string,
  rec?: Recorder,
): Promise<EntityGraph> {
  requireTenant(tenantId);
  const provenance: Provenance[] = [];

  const resolution = await resolveCanonicalEntity(sb, tenantId, ref, rec);
  provenance.push({
    surface: "resolveCanonicalEntity", scope: `tenant_id=${tenantId}`,
    edges: ["resolve"], row_ids: resolution.cluster.map(c => c.id),
    counts: { cluster: resolution.cluster.length },
    note: `classification=${resolution.classification}${resolution.blockers.length ? ` blockers=${resolution.blockers.join(",")}` : ""}`,
  });

  if (!resolution.canonical) {
    // No usable canonical — caller must elect. No axis traversal.
    return { ...resolution, provenance };
  }

  const cid = resolution.canonical.id;

  // ── signals: (c)-semantics — directly_correlated (entity_mentions ∪ auto_correlated) + client_context ──
  const tS = Date.now();
  const { data: mentionRows } = await sb.from("entity_mentions").select("signal_id").eq("entity_id", cid).limit(1000);
  const mentionIds: string[] = (mentionRows || []).map((r: { signal_id: string }) => r.signal_id);
  const { data: autoSignals } = await sb.from("signals")
    .select("id, title, created_at")
    .eq("tenant_id", tenantId).eq("is_test", false).contains("auto_correlated_entities", [cid]).limit(500);
  let mentionSignals: { id: string; title: string; created_at: string }[] = [];
  if (mentionIds.length > 0) {
    const { data } = await sb.from("signals")
      .select("id, title, created_at")
      .eq("tenant_id", tenantId).eq("is_test", false).in("id", mentionIds);
    mentionSignals = data || [];
  }
  const direct: { id: string; title: string; created_at: string }[] = [];
  const seenIds = new Set<string>();
  for (const s of mentionSignals) { if (!seenIds.has(s.id)) { direct.push(s); seenIds.add(s.id); } }
  for (const s of autoSignals || []) { if (!seenIds.has(s.id)) { direct.push(s); seenIds.add(s.id); } }

  let clientContext: { id: string; title: string; created_at: string }[] = [];
  if (resolution.canonical.client_id) {
    const { data: ctx } = await sb.from("signals")
      .select("id, title, created_at")
      .eq("tenant_id", tenantId).eq("client_id", resolution.canonical.client_id).eq("is_test", false)
      .order("created_at", { ascending: false }).limit(50);
    clientContext = (ctx || []).filter((s: { id: string }) => !seenIds.has(s.id));
  }
  rec?.retrieval({
    surface: "entityGraph:signals", tenantScope: tenantId,
    returnedObjectIds: [...direct.map(s => s.id), ...clientContext.map(s => s.id)],
    fallbackPath: "none", timingMs: Date.now() - tS,
    provenance: { canonical: cid, direct: direct.length, client_context: clientContext.length },
  });
  provenance.push({
    surface: "entityGraph:signals", scope: `tenant_id=${tenantId}`,
    edges: ["entity_mentions.entity_id", "signals.auto_correlated_entities"],
    row_ids: [...direct.map(s => s.id), ...clientContext.map(s => s.id)],
    counts: { direct: direct.length, client_context: clientContext.length },
  });

  // ── investigations: investigations.correlated_entity_ids (array) ∋ canonical.id; tenant scope via clients ──
  const tI = Date.now();
  const { data: tenantClients } = await sb.from("clients").select("id").eq("tenant_id", tenantId);
  const clientIds: string[] = (tenantClients || []).map((c: { id: string }) => c.id);
  let investigations: { id: string; file_number: string | null; synopsis: string | null; created_at: string }[] = [];
  if (clientIds.length > 0) {
    const { data } = await sb.from("investigations")
      .select("id, file_number, synopsis, created_at")
      .in("client_id", clientIds).contains("correlated_entity_ids", [cid]).limit(50);
    investigations = data || [];
  }
  rec?.retrieval({
    surface: "entityGraph:investigations", tenantScope: tenantId,
    returnedObjectIds: investigations.map(i => i.id), fallbackPath: "none", timingMs: Date.now() - tI,
  });
  provenance.push({
    surface: "entityGraph:investigations", scope: `tenant_id=${tenantId} via clients`,
    edges: ["investigations.correlated_entity_ids"], row_ids: investigations.map(i => i.id),
    counts: { n: investigations.length },
  });

  // ── sources: entity_content.entity_id = canonical (parent-joined tenant via the canonical entity) ──
  // G5a: limit raised 100→500 to match the parity probe's UI-reality cap.
  // Operational truth convergence > retrieval optimization; pagination is a future slice.
  const tSr = Date.now();
  const { data: contents } = await sb.from("entity_content")
    .select("id, content_type, source, title, url, created_at")
    .eq("entity_id", cid).limit(500);
  const sources = contents || [];
  rec?.retrieval({
    surface: "entityGraph:sources", tenantScope: tenantId,
    returnedObjectIds: sources.map((s: { id: string }) => s.id), fallbackPath: "none", timingMs: Date.now() - tSr,
  });
  provenance.push({
    surface: "entityGraph:sources", scope: `entity_id=${cid} (parent-joined tenant)`,
    edges: ["entity_content.entity_id"], row_ids: sources.map((s: { id: string }) => s.id),
    counts: { n: sources.length },
  });

  // ── scans: not directly linkable v1 (autonomous_scan_results has no entity_id) ──
  const scans = { note: "autonomous_scan_results has no direct entity link in v1; investigate-poi findings flow into entity_content (counted under sources). G3 may add an entity_scans link table." };
  provenance.push({
    surface: "entityGraph:scans", scope: `entity_id=${cid}`, edges: [],
    note: "not_directly_linkable_v1",
  });

  // ── reports: generated_reports.metadata.entity_id = canonical, tenant-scoped ──
  const tR = Date.now();
  const { data: reportRows } = await sb.from("generated_reports")
    .select("id, report_type, title, created_at")
    .eq("tenant_id", tenantId).filter("metadata->>entity_id", "eq", cid).limit(50);
  const reports = reportRows || [];
  rec?.retrieval({
    surface: "entityGraph:reports", tenantScope: tenantId,
    returnedObjectIds: reports.map((r: { id: string }) => r.id), fallbackPath: "none", timingMs: Date.now() - tR,
  });
  provenance.push({
    surface: "entityGraph:reports", scope: `tenant_id=${tenantId}`,
    edges: ["generated_reports.metadata.entity_id"], row_ids: reports.map((r: { id: string }) => r.id),
    counts: { n: reports.length },
  });

  // ── relationships: entity_relationships endpoints; tenant validation by joining BOTH endpoints ──
  const tRel = Date.now();
  const { data: relA } = await sb.from("entity_relationships")
    .select("id, relationship_type, strength, entity_a_id, entity_b_id")
    .eq("entity_a_id", cid).limit(100);
  const { data: relB } = await sb.from("entity_relationships")
    .select("id, relationship_type, strength, entity_a_id, entity_b_id")
    .eq("entity_b_id", cid).limit(100);
  const rawRels = [...(relA || []), ...(relB || [])];
  const otherIds = new Set<string>();
  for (const r of rawRels) otherIds.add(r.entity_a_id === cid ? r.entity_b_id : r.entity_a_id);
  const otherById = new Map<string, { id: string; name: string; type: string }>();
  if (otherIds.size > 0) {
    const { data: otherEntities } = await sb.from("entities")
      .select("id, name, type").in("id", [...otherIds]).eq("tenant_id", tenantId);
    for (const e of (otherEntities || [])) otherById.set(e.id, { id: e.id, name: e.name, type: e.type });
  }
  const relationships: EntityGraphRelationship[] = [];
  for (const r of rawRels) {
    const otherId = r.entity_a_id === cid ? r.entity_b_id : r.entity_a_id;
    const other = otherById.get(otherId);
    if (other) relationships.push({ id: r.id, relationship_type: r.relationship_type, strength: r.strength, other });
  }
  const rejected = rawRels.length - relationships.length;
  rec?.retrieval({
    surface: "entityGraph:relationships", tenantScope: tenantId,
    returnedObjectIds: relationships.map(r => r.id), fallbackPath: "none", timingMs: Date.now() - tRel,
    provenance: { rejected_cross_tenant: rejected },
  });
  provenance.push({
    surface: "entityGraph:relationships", scope: `tenant_id=${tenantId} via both endpoints`,
    edges: ["entity_relationships.entity_a_id|entity_b_id"], row_ids: relationships.map(r => r.id),
    counts: { n: relationships.length, rejected_cross_tenant: rejected },
    note: "entity_relationships has no tenant_id column (G3 hardening); both endpoints tenant-validated at read time",
  });

  // ── recommendations: aegis_recommendations.target_entity_id = canonical, tenant-scoped ──
  const tRec = Date.now();
  const { data: recRows } = await sb.from("aegis_recommendations")
    .select("id, kind, title, status, created_at")
    .eq("target_tenant_id", tenantId).eq("target_entity_id", cid)
    .order("created_at", { ascending: false }).limit(50);
  const recommendations = recRows || [];
  rec?.retrieval({
    surface: "entityGraph:recommendations", tenantScope: tenantId,
    returnedObjectIds: recommendations.map((r: { id: string }) => r.id), fallbackPath: "none", timingMs: Date.now() - tRec,
  });
  provenance.push({
    surface: "entityGraph:recommendations", scope: `target_tenant_id=${tenantId}`,
    edges: ["aegis_recommendations.target_entity_id"], row_ids: recommendations.map((r: { id: string }) => r.id),
    counts: { n: recommendations.length },
  });

  // ── G5 ontology: entity-targeted concepts that ARE surfaced on EntityDetailDialog ──

  // entity_scans — poi_investigations.entity_id; tenant-scoped (poi_investigations has tenant_id).
  const tES = Date.now();
  const { data: scanRows } = await sb.from("poi_investigations")
    .select("id, status, created_at")
    .eq("entity_id", cid).eq("tenant_id", tenantId)
    .order("created_at", { ascending: false }).limit(100);
  const entity_scans = scanRows || [];
  rec?.retrieval({
    surface: "entityGraph:entity_scans", tenantScope: tenantId,
    returnedObjectIds: entity_scans.map((r: { id: string }) => r.id), fallbackPath: "none", timingMs: Date.now() - tES,
  });
  provenance.push({
    surface: "entityGraph:entity_scans", scope: `tenant_id=${tenantId}`,
    edges: ["poi_investigations.entity_id"], row_ids: entity_scans.map((r: { id: string }) => r.id),
    counts: { n: entity_scans.length },
  });

  // entity_reports — poi_reports.entity_id; tenant via parent entity (poi_reports has no tenant_id).
  const tER = Date.now();
  const { data: poiReportRows } = await sb.from("poi_reports")
    .select("id, threat_level, confidence_score, created_at")
    .eq("entity_id", cid)
    .order("created_at", { ascending: false }).limit(100);
  const entity_reports = poiReportRows || [];
  rec?.retrieval({
    surface: "entityGraph:entity_reports", tenantScope: tenantId,
    returnedObjectIds: entity_reports.map((r: { id: string }) => r.id), fallbackPath: "none", timingMs: Date.now() - tER,
  });
  provenance.push({
    surface: "entityGraph:entity_reports", scope: `entity_id=${cid} (parent-joined tenant)`,
    edges: ["poi_reports.entity_id"], row_ids: entity_reports.map((r: { id: string }) => r.id),
    counts: { n: entity_reports.length },
  });

  // photos — entity_photos.entity_id; tenant via parent entity.
  const tPh = Date.now();
  const { data: photoRows } = await sb.from("entity_photos")
    .select("id, storage_path, source, created_at")
    .eq("entity_id", cid)
    .order("created_at", { ascending: false }).limit(100);
  const photos = photoRows || [];
  rec?.retrieval({
    surface: "entityGraph:photos", tenantScope: tenantId,
    returnedObjectIds: photos.map((r: { id: string }) => r.id), fallbackPath: "none", timingMs: Date.now() - tPh,
  });
  provenance.push({
    surface: "entityGraph:photos", scope: `entity_id=${cid} (parent-joined tenant)`,
    edges: ["entity_photos.entity_id"], row_ids: photos.map((r: { id: string }) => r.id),
    counts: { n: photos.length },
  });

  // ── monitoring_state: derived from the canonical entity row ──
  const attrs = (resolution.canonical.attributes ?? {}) as Record<string, unknown>;
  const monitoring_state = {
    active: !!resolution.canonical.active_monitoring_enabled,
    context: (typeof attrs.monitoring_context === "string" ? attrs.monitoring_context : null),
  };
  provenance.push({
    surface: "entityGraph:monitoring_state", scope: `entity_id=${cid}`,
    edges: ["entities.active_monitoring_enabled", "entities.attributes.monitoring_context"],
    counts: { active: monitoring_state.active ? 1 : 0 },
  });

  return {
    ...resolution,
    signals: { directly_correlated: direct, client_context: clientContext },
    investigations,
    sources,
    reports,
    relationships,
    recommendations,
    monitoring_state,
    entity_scans,
    entity_reports,
    photos,
    scans,
    provenance,
  };
}
