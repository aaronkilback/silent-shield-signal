import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  tenantRetrieve, globalLearning, CERTIFIED_TENANT_SURFACES, PENDING_CERTIFICATION,
  type SeamCaller,
} from "./tenant-retrieve.ts";

// ── fake Supabase client: records from()/select()/predicates; awaitable ──────
function fakeSb(rows: unknown[] = []) {
  const calls = { from: null as string | null, select: null as string | null, preds: [] as any[], order: null as any, limit: null as number | null, executed: false };
  const builder: any = {
    select(s: string) { calls.select = s; return builder; },
    in(c: string, v: unknown) { calls.preds.push(["in", c, v]); return builder; },
    eq(c: string, v: unknown) { calls.preds.push(["eq", c, v]); return builder; },
    is(c: string, v: unknown) { calls.preds.push(["is", c, v]); return builder; },
    not(c: string, op: string, v: unknown) { calls.preds.push(["not", c, op, v]); return builder; },
    gte(c: string, v: unknown) { calls.preds.push(["gte", c, v]); return builder; },
    lte(c: string, v: unknown) { calls.preds.push(["lte", c, v]); return builder; },
    gt(c: string, v: unknown) { calls.preds.push(["gt", c, v]); return builder; },
    lt(c: string, v: unknown) { calls.preds.push(["lt", c, v]); return builder; },
    ilike(c: string, v: unknown) { calls.preds.push(["ilike", c, v]); return builder; },
    order(c: string, o: unknown) { calls.order = [c, o]; return builder; },
    limit(n: number) { calls.limit = n; return builder; },
    then(res: (x: { data: unknown[]; error: null }) => void) { calls.executed = true; res({ data: rows, error: null }); },
  };
  const sb: any = { from(t: string) { calls.from = t; return builder; }, _calls: calls };
  return sb;
}

const user = (over: Partial<Extract<SeamCaller, { kind: "user" }>> = {}): SeamCaller =>
  ({ kind: "user", userId: "u1", isSuperAdmin: false, clientIds: ["c1", "c2"], tenantIds: ["t1"], ...over });

// 1 — uncertified surface: no query ever issued
Deno.test("uncertified surface → denied, no .from()", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: user(), surface: "travel", sb });
  assertEquals(r.rows, []);
  assert(r.denied?.includes("uncertified surface"));
  assertEquals(sb._calls.from, null);
});

// 2 — denied caller: no query
Deno.test("denied caller → no query", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: { kind: "denied", reason: "401" }, surface: "signals", sb });
  assertEquals(r.rows, []);
  assertEquals(r.denied, "401");
  assertEquals(sb._calls.from, null);
});

// 3 — tenant_id surface, normal user → scope = caller.tenantIds, applied first
Deno.test("tenant_id surface scopes to caller tenantIds", async () => {
  const sb = fakeSb([{ id: "s1" }]);
  const r = await tenantRetrieve({ caller: user({ tenantIds: ["t1", "t2"] }), surface: "signals", sb });
  assertEquals(sb._calls.from, "signals");
  assertEquals(sb._calls.preds[0], ["in", "tenant_id", ["t1", "t2"]]);
  assertEquals(r.scopeApplied, { column: "tenant_id", values: ["t1", "t2"] });
  assertEquals(r.rows.length, 1);
});

// 4 — client_id surface → scope = caller.clientIds
Deno.test("client_id surface scopes to caller clientIds", async () => {
  const sb = fakeSb();
  await tenantRetrieve({ caller: user(), surface: "documents", sb });
  assertEquals(sb._calls.from, "archival_documents");
  assertEquals(sb._calls.preds[0], ["in", "client_id", ["c1", "c2"]]);
});

// 5 — client_id surface, empty clientIds → fail-closed, NO query
Deno.test("empty clientIds → fail-closed, no query", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: user({ clientIds: [] }), surface: "documents", sb });
  assertEquals(r.rows, []);
  assertEquals(sb._calls.from, null);
  assertEquals(r.scopeApplied, { column: "client_id", values: [] });
});

// 6 — super_admin, no explicit scope → fail-closed (no all-tenant enumeration)
Deno.test("super_admin without explicit scope → empty, no query", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: user({ isSuperAdmin: true, tenantIds: ["t1"] }), surface: "signals", sb });
  assertEquals(r.rows, []);
  assertEquals(sb._calls.from, null);
});

// 7 — super_admin with explicit authorized tenant → single-tenant scope
Deno.test("super_admin with explicit tenant → scoped to that tenant", async () => {
  const sb = fakeSb([{ id: "x" }]);
  await tenantRetrieve({ caller: user({ isSuperAdmin: true }), surface: "signals", scope: { tenantId: "t9" }, sb });
  assertEquals(sb._calls.preds[0], ["in", "tenant_id", ["t9"]]);
});

// 8 — explicit tenant NOT in a normal user's set → denied, no query
Deno.test("explicit tenant outside caller scope → denied", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: user({ tenantIds: ["t1"] }), surface: "signals", scope: { tenantId: "t2" }, sb });
  assertEquals(r.rows, []);
  assertEquals(sb._calls.from, null);
});

// 9 — spec cannot strip the scope predicate (scope always present, applied first)
Deno.test("spec filters cannot remove scope predicate", async () => {
  const sb = fakeSb();
  await tenantRetrieve({
    caller: user(), surface: "signals", sb,
    spec: { filters: [{ column: "severity", op: "eq", value: "high" }], limit: 10 },
  });
  assertEquals(sb._calls.preds[0], ["in", "tenant_id", ["t1"]]);   // scope first
  assertEquals(sb._calls.preds[1], ["eq", "severity", "high"]);    // refinement after
  assertEquals(sb._calls.limit, 10);
});

// 10 — uncertified embed → denied, no query (join-expansion defused)
Deno.test("uncertified embed → denied", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: user(), surface: "signals", sb, spec: { embeds: ["secret_table(*)"] } });
  assert(r.denied?.includes("uncertified embed"));
  assertEquals(sb._calls.from, null);
});

// 10b — certified embed → allowed, appears in select
Deno.test("certified embed → permitted in select", async () => {
  const sb = fakeSb();
  await tenantRetrieve({ caller: user(), surface: "incidents", sb, spec: { embeds: ["signals!incidents_signal_id_fkey(id)"] } });
  assert(sb._calls.select.includes("signals!incidents_signal_id_fkey(id)"));
});

// 11 — disallowed filter op → denied, no query
Deno.test("disallowed filter op → denied", async () => {
  const sb = fakeSb();
  const r = await tenantRetrieve({ caller: user(), surface: "signals", sb, spec: { filters: [{ column: "x", op: "or" as any }] } });
  assert(r.denied?.includes("disallowed filter op"));
  assertEquals(sb._calls.from, null);
});

// 11b — isNotNull op applies IS NOT NULL (narrowing), after the scope predicate
Deno.test("isNotNull op applies IS NOT NULL", async () => {
  const sb = fakeSb();
  await tenantRetrieve({
    caller: user(), surface: "entities", sb,
    spec: { filters: [{ column: "threat_score", op: "isNotNull" }] },
  });
  assertEquals(sb._calls.preds[0], ["in", "tenant_id", ["t1"]]);          // scope first
  assertEquals(sb._calls.preds[1], ["not", "threat_score", "is", null]); // IS NOT NULL after
});

// 12 — service caller, single resolved tenant → scoped to it
Deno.test("service caller scoped to its single tenant", async () => {
  const sb = fakeSb();
  await tenantRetrieve({ caller: { kind: "service", tenantId: "t5", clientIds: ["c9"] }, surface: "signals", sb });
  assertEquals(sb._calls.preds[0], ["in", "tenant_id", ["t5"]]);
});

// 13 — globalLearning reads ONLY global_chunks, no tenant predicate, no embeds
Deno.test("globalLearning reads global_chunks with no tenant predicate", async () => {
  const sb = fakeSb([{ id: "g1" }]);
  const r = await globalLearning({ sb });
  assertEquals(sb._calls.from, "global_chunks");
  assert(!sb._calls.preds.some((p: any[]) => p[1] === "tenant_id" || p[1] === "client_id"));
  assertEquals(r.scopeApplied, null);
  assertEquals(r.rows.length, 1);
});

Deno.test("globalLearning rejects embeds", async () => {
  const sb = fakeSb();
  const r = await globalLearning({ sb, spec: { embeds: ["clients(*)"] } });
  assert(r.denied?.includes("does not permit embeds"));
  assertEquals(sb._calls.from, null);
});

// 14 — every call returns a RetrievalTrace (provenance structure)
Deno.test("trace structure emitted on success and on denial", async () => {
  const ok = await tenantRetrieve({ caller: user(), surface: "signals", sb: fakeSb() });
  assertEquals(ok.trace.surface, "signals");
  assertEquals(ok.trace.callerKind, "user");
  assert(typeof ok.trace.timestamp === "string" && ok.trace.timestamp.includes("T"));
  const denied = await tenantRetrieve({ caller: user(), surface: "travel", sb: fakeSb() });
  assertEquals(denied.trace.denied, "uncertified surface: travel");
});

// 15 — certification artifact integrity
Deno.test("every certified surface carries a non-empty certificationReason", () => {
  for (const s of Object.values(CERTIFIED_TENANT_SURFACES)) {
    assert(s.certificationReason && s.certificationReason.length > 10, `${s.key} missing reason`);
  }
});
Deno.test("entities is CERTIFIED (B6 backfill+trigger) and no longer pending", () => {
  assert("entities" in CERTIFIED_TENANT_SURFACES);
  assertEquals(CERTIFIED_TENANT_SURFACES.entities.scope, "tenant_id");
  assert(CERTIFIED_TENANT_SURFACES.entities.certificationReason.includes("B6"));
  assert(!("entities" in PENDING_CERTIFICATION));
});
