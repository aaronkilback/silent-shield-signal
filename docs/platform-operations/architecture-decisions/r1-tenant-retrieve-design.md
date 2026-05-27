# R1 — `tenantRetrieve()` Design + Certification Workflow (implementation planning)

**Status:** DESIGN / planning. **No code.** Implements the ratified Certified-Safe Retrieval Allowlist (principle 14) + Cross-Tenant Retrieval Exclusivity (principle 13). This is the single read seam for tenant Aegis.

## Doctrine lock (RATIFIED — no exceptions)
**No raw retrieval of tenant data outside `tenantRetrieve()`. No exceptions. No helper shortcuts. No temporary bypasses. No service-role convenience reads.** A tenant-facing surface reaching data any other way is a build failure (blocking CI guard) and a doctrine violation. Cross-tenant reads are Aegis Ops only, via the audited Ops seam.

## `tenantRetrieve()` interface
```ts
// Resolved server-side, spoof-proof, from tenant_users (never client-claimed).
interface TenantContext { tenantId: string; userId: string; }

type ScopeKey =
  | { kind: 'direct'; column: 'tenant_id' }
  | { kind: 'parent_join'; fk: string; parent: 'entities'; parentScope: 'tenant_id' }
  | { kind: 'edge_join'; endpoints: string[]; parent: 'entities'; parentScope: 'tenant_id' }
  | { kind: 'client_cascade'; column: 'client_id' }            // client_id ∈ clients WHERE tenant_id = ctx
  | { kind: 'owned_or_global'; column: 'created_by_tenant_id'; allowGlobalNullTenant: boolean };

interface CertifiedSurface {
  surface: string;            // logical name, e.g. 'entities'
  table: string;
  layer: 'L1';                // tenant surfaces are L1; L2 goes through globalLearning(), not here
  scopeKey: ScopeKey;
  certifiedAt: string;        // ISO
  certifiedBy: string;        // operator
  proofRef: string;           // → docs/platform-operations/certifications/<surface>.md
}

// The ALLOWLIST. Empty until surfaces are certified. Single source of truth.
const CERTIFIED_TENANT_SURFACES: ReadonlyMap<string, CertifiedSurface>;

async function tenantRetrieve(
  surface: string,
  ctx: TenantContext,
  opts?: { select?: string; filters?: Filter[]; limit?: number; order?: Order },
): Promise<{ rows: Row[] }>   // throws UncertifiedSurfaceError if surface ∉ allowlist
```
**Behavior:** look up `surface` in `CERTIFIED_TENANT_SURFACES`. If absent → `UncertifiedSurfaceError` (default-deny). If present → apply `scopeKey` bound to `ctx.tenantId` **before** any caller filter, then query. The scope clause is non-removable by callers (opts can narrow, never widen).

## Supported scope-key patterns (the 5)
| Pattern | Applied clause | Surfaces |
|---|---|---|
| `direct` | `WHERE tenant_id = ctx.tenantId` | entities, signals, incidents, reports, generated_reports |
| `parent_join` | `JOIN entities ON <fk>=entities.id WHERE entities.tenant_id = ctx.tenantId` | entity_content, entity_mentions, poi_reports |
| `edge_join` | both endpoints resolve to `entities.tenant_id = ctx.tenantId`; foreign-endpoint edges excluded | entity_relationships |
| `client_cascade` | `WHERE client_id IN (SELECT id FROM clients WHERE tenant_id = ctx.tenantId)` | investigations, archival_documents (until tenant_id added) |
| `owned_or_global` | `WHERE created_by_tenant_id = ctx.tenantId` (+ approved global null-tenant if `allowGlobalNullTenant`) | sources |

## Certification workflow (uncertified → certified)
A surface moves to the allowlist only after ALL pass, each step recorded:
1. **Declare** surface + `ScopeKey` pattern.
2. **Seam-route** it: the only access path is `tenantRetrieve()`; remove/close every raw `.from()` path to the same data (R2). CI grep guard verifies none remain.
3. **Isolation proof (empirical):** with `ctx = tenant A`, retrieve and assert **0 rows belonging to any other tenant** — for join/edge/cascade surfaces, explicitly seed a foreign-tenant row and prove it is excluded. Record query + result.
4. **(L2 only)** anonymization proof — N/A here (L2 is `globalLearning()`); listed for completeness.
5. **Record + add** to `CERTIFIED_TENANT_SURFACES` via PR; the `proofRef` points to the recorded proof.
**Demotion:** any later evidence of leakage immediately removes the surface from the allowlist (default-deny restores).

## Certification registry + proof recording
- **Registry:** `CERTIFIED_TENANT_SURFACES` in `_shared/tenant-retrieve.ts` (code) — the runtime allowlist. Mirrored as a human table in this doc family.
- **Proofs:** `docs/platform-operations/certifications/<surface>.md` — `{ surface, scope_key, date, operator, method, probe_query, result: "0 cross-tenant rows", foreign_seed_excluded: true }`. One file per certified surface; immutable record. The registry entry's `proofRef` cites it.

## Honest-refusal surfacing to Aegis
`tenantRetrieve()` throws `UncertifiedSurfaceError(surface)` → the tool/handler returns a structured refusal → Aegis renders it plainly, never simulating data:
> *"I can't safely access investigation correlations yet — that retrieval surface hasn't been certified for tenant access."*

This is **intentional behavior, not a bug.** It is the read-side of the action-integrity honest-refusal rule (AR4): unavailable = say so, never fabricate. The refusal names the surface and frames it as a certification gap, not a failure.

## Certification progression (ordered)
**Tier 1 — direct `tenant_id`, simplest isolation proof (certify first):**
`entities`, `signals`, `generated_reports` → then `reports`, `incidents` (the latter only after its handler is tenant-scoped, R2 / INC-AEGIS-TRUST).

**Tier 2 — join/edge/cascade complexity (certify after join-scoping proven):**
`entity_relationships` (edge_join), `entity_content` + `entity_mentions` (parent_join, "scans"), `investigations` (client_cascade), `sources` (owned_or_global).

**Tier 3 — blocked on remediation:**
`archival_documents` — **cannot certify until INC-CRT-DOCUMENT-SCOPE adds `tenant_id`** (today it has only `client_id`; the cascade is interim, full certification waits for the owned column).

L2 enrichment surfaces are certified separately through `globalLearning()` from the ratified-clean set only; contaminated stores remain blocked (INC-LEARN-CONTAM).

## Dependencies + sequencing
R1 (this seam) is roadmap Phase B; it is the prerequisite for R2 (Phase C), the tenant cross-asset reasoning surface (Phase K, `aegis-tenant-intelligence-retrieval.md`), and the Aegis Ops seam. The allowlist starts **empty** and grows one certified surface at a time per the progression above.

**No code. Design + workflow only. Implementation begins only on explicit go, Tier-1 first.**
