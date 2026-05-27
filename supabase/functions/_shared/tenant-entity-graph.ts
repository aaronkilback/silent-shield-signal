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
