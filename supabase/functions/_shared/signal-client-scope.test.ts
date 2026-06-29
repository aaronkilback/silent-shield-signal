// INC-SIGNALS-CLIENT-SCOPE — focused tests for the canonical Aegis
// get_recent_signals client-isolation containment.
//
// Run: deno test --allow-read --no-check supabase/functions/_shared/signal-client-scope.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeSignalClientScope } from "./signal-client-scope.ts";

// Two clients, one tenant. User A is authorized only for Client A.
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // sibling client, same tenant — User A NOT authorized
const accessibleA = [A];

Deno.test("Aegis scoped to A returns A only (selected client in accessible set)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: accessibleA, requestedClientId: A, hasUser: true });
  assertEquals(d.mode, "single-client");
  assertEquals(d.clientIds, [A]);
});

Deno.test("User A requesting Client B → denied (selected client NOT in accessible set)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: accessibleA, requestedClientId: B, hasUser: true });
  assertEquals(d.mode, "deny");
  assertEquals(d.clientIds, []);
  assert(!d.clientIds.includes(B));
});

Deno.test("No selected client cannot surface Client B (scopes to accessible set only)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: accessibleA, requestedClientId: null, hasUser: true });
  assertEquals(d.mode, "client-set");
  assertEquals(d.clientIds, [A]);
  assert(!d.clientIds.includes(B));
});

Deno.test("Frontend/model tampering with a sibling client id cannot widen results", () => {
  // Caller's real access is [A]; the model/frontend supplies B (tampering).
  const d = computeSignalClientScope({ accessibleClientIds: accessibleA, requestedClientId: B, hasUser: true });
  assertEquals(d.mode, "deny"); // never single-client [B], never client-set including B
});

Deno.test("Tampering with the accessible-set shape still cannot include a non-member", () => {
  // Even if a duplicate/empty sneaks into the derived set, output is the de-duped
  // server set; a requested non-member is still denied.
  const d = computeSignalClientScope({ accessibleClientIds: [A, A, "", A], requestedClientId: null, hasUser: true });
  assertEquals(d.mode, "client-set");
  assertEquals(d.clientIds, [A]); // de-duped, no empties
});

Deno.test("No authenticated caller → fail closed (deny, never all-clients)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: [A, B], requestedClientId: null, hasUser: false });
  assertEquals(d.mode, "deny");
  assertEquals(d.clientIds, []);
});

Deno.test("Empty accessible set with no selection → fail closed (null access ≠ all clients)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: [], requestedClientId: null, hasUser: true });
  assertEquals(d.mode, "deny");
});

Deno.test("Requested client name that resolves to nothing → fail closed (no silent widen)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: accessibleA, requestedUnresolved: true, hasUser: true });
  assertEquals(d.mode, "deny");
});

Deno.test("Legitimate multi-client user, no selection → both accessible clients (and only those)", () => {
  const d = computeSignalClientScope({ accessibleClientIds: [A, B], requestedClientId: null, hasUser: true });
  assertEquals(d.mode, "client-set");
  assertEquals(new Set(d.clientIds), new Set([A, B]));
});

Deno.test("Multi-client user selecting one of their clients → only that client", () => {
  const d = computeSignalClientScope({ accessibleClientIds: [A, B], requestedClientId: B, hasUser: true });
  assertEquals(d.mode, "single-client");
  assertEquals(d.clientIds, [B]);
});

// ── Handler source invariants — prove the wiring uses the server-derived set ──
const HANDLER = Deno.readTextFileSync(new URL("./handlers-signals-incidents.ts", import.meta.url));
function recentSignalsBody(src: string): string {
  const s = src.indexOf("get_recent_signals: async");
  assert(s > -1, "get_recent_signals handler present");
  // up to the next handler in the registry
  const next = src.indexOf("get_active_incidents", s);
  return src.slice(s, next > -1 ? next : src.length);
}

Deno.test("handler derives accessible clients server-side from the authenticated user id", () => {
  const body = recentSignalsBody(HANDLER);
  // signature uses the authenticated userId (no longer the discarded _userId)
  assert(/get_recent_signals: async \(args, supabaseClient, userId, tenantId/.test(HANDLER));
  assert(/getAccessibleClientIds\(supabaseClient, userId\)/.test(body));
  assert(/isSuperAdmin\(supabaseClient, userId\)/.test(body));
  assert(/computeSignalClientScope\(/.test(body));
});

Deno.test("handler constrains the query by client_id and excludes null-client via clients!inner", () => {
  const body = recentSignalsBody(HANDLER);
  assert(/clients!inner\(/.test(body), "inner join excludes null-client signals");
  assert(/\.in\("client_id", scope\.clientIds\)/.test(body), "client-set narrowing applied");
  assert(/scope\.mode === "deny"/.test(body), "deny short-circuits to empty");
});

Deno.test("handler does NOT trust a frontend/model client value as the accessible authority", () => {
  const body = recentSignalsBody(HANDLER);
  // accessible set comes from getAccessibleClientIds(userId), never from args
  assert(!/getAccessibleClientIds\([^)]*args/.test(body), "accessible set never derived from args");
});
