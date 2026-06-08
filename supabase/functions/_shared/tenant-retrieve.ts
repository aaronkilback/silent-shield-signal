/**
 * A4.1 — tenant retrieval SEAM (additive; ZERO callers wired in this step).
 *
 * Doctrine: "the security boundary is RETRIEVAL, not response" (CLAUDE.md). This is
 * the single, fail-closed, certified path for reading tenant data. It is INERT until
 * callers are migrated (A4.3) — nothing imports it yet, so it changes no runtime path.
 *
 * THREE PHYSICALLY SEPARATE PATHS (never one with a flag):
 *   tenantRetrieve()   — data the CALLER is authorized for (own tenants/clients, or a
 *                        single service-on-behalf tenant). Never cross-tenant.
 *   globalLearning()   — approved global doctrine/tradecraft only (global_chunks). No
 *                        tenant facts, ever; no tenant predicate (the store is ownerless).
 *   operatorRetrieve() — cross-tenant, by explicit target_tenant, AUDITED. *** NOT
 *                        IMPLEMENTED HERE. *** Reserved by name only. Do NOT add
 *                        cross-tenant access to tenantRetrieve() — that is how
 *                        exceptions accumulate and bypass the boundary. When operator
 *                        retrieval is needed, build operatorRetrieve() with its own
 *                        audit trail; never widen this function.
 *
 * The seam OWNS from()/scope/embeds/order/limit. Callers provide INTENT via a
 * declarative RetrieveSpec — there is no query(builder) callback and no escape hatch,
 * so no caller can expand scope via joins, alternate ownership paths, or a fresh from().
 */
import { createServiceClient } from "./supabase-client.ts";
import { resolveUserCaller, type CallerAuth } from "./caller-auth.ts";
import { getCallerIdentity } from "./supabase-client.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ───────────────────────────────────────────────────────────────────────────
// CERTIFICATION ARTIFACT — a security-review record, not a convenience registry.
// A surface is admitted ONLY on ownership proof. certificationReason is required.
// Adding an entry = asserting the evidence in its reason is true.
// ───────────────────────────────────────────────────────────────────────────
export type CertifiedScope = "tenant_id" | "client_id";
export interface CertifiedSurface {
  key: string;
  table: string;
  scope: CertifiedScope;
  certificationReason: string; // ownership PROOF — reviewed evidence, not "has a column"
}

export const CERTIFIED_TENANT_SURFACES: Record<string, CertifiedSurface> = {
  signals: {
    key: "signals", table: "signals", scope: "tenant_id",
    certificationReason:
      "tenant_id enforced via signals_derive_tenant_id_trigger; A1.1 prod NULL-tenant=0; realtime tenant-filtered (Phase 4, prod); retrieval-boundary audited (Paths 1–5).",
  },
  incidents: {
    key: "incidents", table: "incidents", scope: "tenant_id",
    certificationReason:
      "tenant_id via trg_derive_incident_tenant; A1.1 prod NULL-tenant=0; embed disambiguated (generate-incident-briefing); RLS on.",
  },
  entities: {
    key: "entities", table: "entities", scope: "tenant_id",
    certificationReason:
      "CERTIFIED 2026-06-07 (B6). tenant_id enforced via trg_derive_entity_tenant (prod+staging); B6 backfill → A1.1 client-owned NULL-tenant=0 on BOTH envs (prod 104→0, staging 10→0); fail-closed trigger verified (resolvable insert stamps tenant_id; unresolvable claimed owner raises 23514, no row); retrieval-purity probe on staging (3 tenants) = 0 cross-tenant leak + 0 ownerless leak; narrative batch (synthesize-entity-narratives) narrates only owned, actively-monitored entities (0 ownerless/null-tenant narratable). RLS on; owner cols present both envs.",
  },
  reports: {
    key: "reports", table: "generated_reports", scope: "tenant_id",
    certificationReason:
      "tenant_id NOT NULL (provenance positive model); A1.1 prod NULL-tenant=0; Phase 1.7 report isolation.",
  },
  rag_chunks: {
    key: "rag_chunks", table: "tenant_chunks", scope: "tenant_id",
    certificationReason:
      "tenant_id NOT NULL (provenance positive model); A1.1 prod NULL-tenant=0.",
  },
  documents: {
    key: "documents", table: "archival_documents", scope: "client_id",
    certificationReason:
      "client_id scoped + RLS; transport tenant_id closure tracked in A7 (does not affect client_id seam scoping).",
  },
  site_assessments: {
    key: "site_assessments", table: "site_audits", scope: "client_id",
    certificationReason:
      "client_id scoped + RLS; Site Assessment v1 retrieval audited.",
  },
};

// The reviewable other half of the artifact: what is NOT certified and WHY.
export const PENDING_CERTIFICATION: Record<string, string> = {
  investigations:
    "client_id + RLS present but no isolation audit on record — certify after a focused isolation check.",
  travel:
    "no isolation proof and no wired retrieval tool (search omitted per Cycle-2 design).",
  red_team:
    "no isolation proof and no wired retrieval tool.",
  arcgis:
    "no isolation proof; arcgis.read not implemented.",
  find_similar_signals_by_embedding:
    "RPC reads tenant-owned signals with NO scope/param (real gap, reachable via correlate-signals) — never admitted until it takes a client/tenant parameter.",
};

// Embeds are allowlisted by relationship ROOT (the token before "("), defusing the
// join-expansion vector: a spec may only embed a certified, scope-safe relationship.
export const CERTIFIED_EMBEDS: Record<string, string> = {
  "clients": "owner embed — clients row is the row's own owner (same tenant).",
  "signals!incidents_signal_id_fkey":
    "B1-disambiguated originating signal — same tenant as the incident (to-one FK).",
};

// ───────────────────────────────────────────────────────────────────────────
// Declarative retrieval spec — callers express INTENT; the seam builds the query.
// Filter ops are NARROWING-ONLY and AND-combined AFTER the scope predicate, so no
// spec can widen past tenant scope. No top-level OR, no RPC, no raw builder.
// ───────────────────────────────────────────────────────────────────────────
export type NarrowOp = "eq" | "in" | "gte" | "lte" | "gt" | "lt" | "ilike" | "isNull" | "isNotNull";
const ALLOWED_OPS = new Set<NarrowOp>(["eq", "in", "gte", "lte", "gt", "lt", "ilike", "isNull", "isNotNull"]);

export interface RetrieveFilter { column: string; op: NarrowOp; value?: unknown }
export interface RetrieveSpec {
  columns?: string[];
  filters?: RetrieveFilter[];
  embeds?: string[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Caller — normalized + already authorization-resolved. tenantRetrieve never reads
// a body id; the caller carries the authorized scope. service = single resolved tenant.
// ───────────────────────────────────────────────────────────────────────────
export type SeamCaller =
  | { kind: "user"; userId: string; isSuperAdmin: boolean; clientIds: string[]; tenantIds: string[] }
  | { kind: "service"; tenantId: string; clientIds: string[] }
  | { kind: "denied"; reason: string };

// ───────────────────────────────────────────────────────────────────────────
// RETRIEVAL PROVENANCE — STRUCTURE ONLY in A4.1. No persistence, no telemetry, no
// DB write. Returned so A4.3+ can emit/record it without redesigning the seam.
// Answers the future question: "what facts did you retrieve before recommending?"
// ───────────────────────────────────────────────────────────────────────────
export interface RetrievalTrace {
  surface: string;
  callerKind: string;
  scopeApplied: { column: CertifiedScope; values: string[] } | null;
  spec: RetrieveSpec | null;
  timestamp: string; // ISO-8601
  denied?: string;
}

export interface RetrieveResult<T = any> {
  rows: T[];
  surface: string;
  scopeApplied: { column: CertifiedScope; values: string[] } | null;
  trace: RetrievalTrace;
  denied?: string;
}

// ── caller resolution (thin wrapper over existing, verified helpers) ─────────
// service-role callers MUST declare a single on-behalf tenant; a bare service caller
// with no target is denied (the seam is not a service-role cross-tenant bypass).
export async function resolveSeamCaller(
  req: Request,
  serviceSb: SupabaseClient,
  opts?: { onBehalfOfTenantId?: string },
): Promise<SeamCaller> {
  const id = await getCallerIdentity(req);
  if (id.kind === "unauthorized") return { kind: "denied", reason: id.error };
  if (id.kind === "service_role") {
    const t = opts?.onBehalfOfTenantId;
    if (!t) return { kind: "denied", reason: "service caller without a resolved on-behalf tenant" };
    const { data } = await serviceSb.from("clients").select("id").eq("tenant_id", t);
    const clientIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    return { kind: "service", tenantId: t, clientIds };
  }
  const caller: CallerAuth | null = await resolveUserCaller(req, serviceSb);
  if (!caller) return { kind: "denied", reason: "authentication required" };
  return {
    kind: "user", userId: caller.userId, isSuperAdmin: caller.isSuperAdmin,
    clientIds: caller.clientIds, tenantIds: caller.tenantIds,
  };
}

function embedRoot(embed: string): string {
  return embed.split("(")[0].trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

// Resolve the authorized scope values for the surface's scope column.
// Returns null when the caller may not retrieve at all (→ fail-closed empty).
function resolveScopeValues(
  caller: SeamCaller,
  scope: CertifiedScope,
  explicit?: { tenantId?: string; clientId?: string },
): string[] | null {
  if (caller.kind === "denied") return null;

  if (scope === "tenant_id") {
    const explicitT = explicit?.tenantId;
    if (caller.kind === "service") {
      if (explicitT && explicitT !== caller.tenantId) return null; // service is single-tenant
      return [caller.tenantId];
    }
    // user
    if (explicitT) {
      if (caller.isSuperAdmin) return [explicitT];                 // super_admin tenant-view: single explicit tenant
      return caller.tenantIds.includes(explicitT) ? [explicitT] : null;
    }
    if (caller.isSuperAdmin) return null;                          // no implicit all-tenant enumeration
    return caller.tenantIds.length ? caller.tenantIds : null;
  }

  // scope === "client_id"
  const explicitC = explicit?.clientId;
  if (caller.kind === "service") {
    if (explicitC && !caller.clientIds.includes(explicitC)) return null;
    return explicitC ? [explicitC] : (caller.clientIds.length ? caller.clientIds : null);
  }
  if (explicitC) {
    if (caller.isSuperAdmin) return [explicitC];
    return caller.clientIds.includes(explicitC) ? [explicitC] : null;
  }
  if (caller.isSuperAdmin) return null;
  return caller.clientIds.length ? caller.clientIds : null;
}

// ── the seam ─────────────────────────────────────────────────────────────────
export async function tenantRetrieve(args: {
  caller: SeamCaller;
  surface: string;
  scope?: { tenantId?: string; clientId?: string };
  spec?: RetrieveSpec;
  sb?: SupabaseClient;
}): Promise<RetrieveResult> {
  const { caller, surface, scope, spec } = args;
  const base = (denied: string): RetrieveResult => ({
    rows: [], surface, scopeApplied: null,
    trace: { surface, callerKind: caller.kind, scopeApplied: null, spec: spec ?? null, timestamp: nowIso(), denied },
    denied,
  });

  const def = CERTIFIED_TENANT_SURFACES[surface];
  if (!def) return base(`uncertified surface: ${surface}`);
  if (caller.kind === "denied") return base(caller.reason);

  // fail-closed spec validation — any malformed/uncertified element → no query
  if (spec?.filters) {
    for (const f of spec.filters) {
      if (!ALLOWED_OPS.has(f.op)) return base(`disallowed filter op: ${f.op}`);
      if (typeof f.column !== "string" || !f.column) return base("filter missing column");
    }
  }
  if (spec?.embeds) {
    for (const e of spec.embeds) {
      if (!CERTIFIED_EMBEDS[embedRoot(e)]) return base(`uncertified embed: ${embedRoot(e)}`);
    }
  }

  const values = resolveScopeValues(caller, def.scope, scope);
  if (!values || values.length === 0) {
    // authorized-but-no-scope (e.g. super_admin without explicit selection, empty clients)
    const scopeApplied = { column: def.scope, values: [] as string[] };
    return {
      rows: [], surface, scopeApplied,
      trace: { surface, callerKind: caller.kind, scopeApplied, spec: spec ?? null, timestamp: nowIso() },
    };
  }

  const sb = args.sb ?? createServiceClient();
  const selectStr = [...(spec?.columns?.length ? spec.columns : ["*"]), ...(spec?.embeds ?? [])].join(", ");

  let q: any = sb.from(def.table).select(selectStr);
  q = q.in(def.scope, values); // SCOPE FIRST — built by the seam, unremovable by the spec
  for (const f of spec?.filters ?? []) {
    switch (f.op) {
      case "eq": q = q.eq(f.column, f.value); break;
      case "in": q = q.in(f.column, f.value as unknown[]); break;
      case "gte": q = q.gte(f.column, f.value); break;
      case "lte": q = q.lte(f.column, f.value); break;
      case "gt": q = q.gt(f.column, f.value); break;
      case "lt": q = q.lt(f.column, f.value); break;
      case "ilike": q = q.ilike(f.column, f.value as string); break;
      case "isNull": q = q.is(f.column, null); break;
      case "isNotNull": q = q.not(f.column, "is", null); break;
    }
  }
  if (spec?.order) q = q.order(spec.order.column, { ascending: spec.order.ascending ?? false });
  if (typeof spec?.limit === "number") q = q.limit(spec.limit);

  const scopeApplied = { column: def.scope, values };
  const { data, error } = await q;
  if (error) {
    return {
      rows: [], surface, scopeApplied,
      trace: { surface, callerKind: caller.kind, scopeApplied, spec: spec ?? null, timestamp: nowIso(), denied: `query error: ${error.message}` },
      denied: `query error: ${error.message}`,
    };
  }
  return {
    rows: data ?? [], surface, scopeApplied,
    trace: { surface, callerKind: caller.kind, scopeApplied, spec: spec ?? null, timestamp: nowIso() },
  };
}

// ── approved global doctrine/tradecraft retrieval — PHYSICALLY SEPARATE ───────
// Reads the ownerless global_chunks store ONLY. No tenant predicate (the store has no
// owner columns), and it must never carry tenant facts. Never use for tenant data.
const GLOBAL_LEARNING_TABLE = "global_chunks";
export async function globalLearning(args?: { spec?: RetrieveSpec; sb?: SupabaseClient }): Promise<RetrieveResult> {
  const spec = args?.spec;
  const trace = (denied?: string): RetrievalTrace =>
    ({ surface: GLOBAL_LEARNING_TABLE, callerKind: "global", scopeApplied: null, spec: spec ?? null, timestamp: nowIso(), ...(denied ? { denied } : {}) });

  if (spec?.embeds && spec.embeds.length) {
    const d = "globalLearning does not permit embeds";
    return { rows: [], surface: GLOBAL_LEARNING_TABLE, scopeApplied: null, trace: trace(d), denied: d };
  }
  if (spec?.filters) {
    for (const f of spec.filters) {
      if (!ALLOWED_OPS.has(f.op)) {
        const d = `disallowed filter op: ${f.op}`;
        return { rows: [], surface: GLOBAL_LEARNING_TABLE, scopeApplied: null, trace: trace(d), denied: d };
      }
    }
  }

  const sb = args?.sb ?? createServiceClient();
  let q: any = sb.from(GLOBAL_LEARNING_TABLE).select((spec?.columns?.length ? spec.columns : ["*"]).join(", "));
  for (const f of spec?.filters ?? []) {
    switch (f.op) {
      case "eq": q = q.eq(f.column, f.value); break;
      case "in": q = q.in(f.column, f.value as unknown[]); break;
      case "gte": q = q.gte(f.column, f.value); break;
      case "lte": q = q.lte(f.column, f.value); break;
      case "gt": q = q.gt(f.column, f.value); break;
      case "lt": q = q.lt(f.column, f.value); break;
      case "ilike": q = q.ilike(f.column, f.value as string); break;
      case "isNull": q = q.is(f.column, null); break;
      case "isNotNull": q = q.not(f.column, "is", null); break;
    }
  }
  if (spec?.order) q = q.order(spec.order.column, { ascending: spec.order.ascending ?? false });
  if (typeof spec?.limit === "number") q = q.limit(spec.limit);

  const { data, error } = await q;
  if (error) {
    return { rows: [], surface: GLOBAL_LEARNING_TABLE, scopeApplied: null, trace: trace(`query error: ${error.message}`), denied: `query error: ${error.message}` };
  }
  return { rows: data ?? [], surface: GLOBAL_LEARNING_TABLE, scopeApplied: null, trace: trace() };
}

// operatorRetrieve(): intentionally NOT implemented in A4.1. Cross-tenant retrieval
// belongs to the audited Aegis Ops control plane and must be built as its own seam
// (explicit target_tenant + operator_actions_log). Do not add it here.
