/**
 * Tenant Isolation Invariant — REGRESSION GATE
 *
 * INVARIANT (load-bearing):
 *   A user scoped to tenant A must never retrieve a row that belongs
 *   to tenant B from signals, clients, entities, incidents,
 *   investigations, or reports. Enforced at the database layer via
 *   RLS policies built on get_user_accessible_client_ids() +
 *   is_super_admin() bypass.
 *
 * Why this test exists:
 *   On 2026-05-18 a hotmail super_admin observation session surfaced
 *   Petronas (Silent Shield Operations) data while CRT was selected.
 *   Root cause was a UI-layer scoping gap (super_admin RLS bypass +
 *   queries that didn't filter by tenant_id when no client was
 *   selected). The DB-layer RLS was correct; the proof was manual.
 *   This test makes that proof automatic so future schema or policy
 *   changes can't silently undo isolation.
 *
 * Architecture (deterministic, not browser-driven):
 *   - Two fixture tenants seeded by migration
 *     20260519160000_invariant_isolation_fixtures.sql
 *     (tenant A = 11111111-aaaa…, tenant B = 22222222-bbbb…).
 *   - Each tenant gets one row per guarded table.
 *   - Two fixture auth users (created by
 *     scripts/setup-invariant-users.mjs), each an `analyst` scoped
 *     to exactly one tenant. NEITHER is super_admin — that's
 *     deliberate, because super_admin bypasses RLS and would void
 *     the test.
 *   - Test signs in as each user via signInWithPassword (real
 *     production auth path), gets a JWT, and runs PostgREST queries.
 *     This exercises the same code path the production frontend
 *     uses, not a simulated one.
 *
 * Test is wired into Fortress CI's `Unit Tests (Vitest)` job. The
 * required GitHub Actions secrets are TEST_INVARIANT_USER_A_EMAIL,
 * TEST_INVARIANT_USER_A_PASSWORD, TEST_INVARIANT_USER_B_EMAIL,
 * TEST_INVARIANT_USER_B_PASSWORD. If they're missing in CI, the test
 * fails with a clear error (rather than silently skipping).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Fixture coordinates (hand-pinned, must match the migration) ──
const TENANT_A_ID = "11111111-aaaa-4aaa-aaaa-000000000001";
const TENANT_B_ID = "22222222-bbbb-4bbb-bbbb-000000000002";
const CLIENT_A_ID = "11111111-cccc-4ccc-cccc-000000000001";
const CLIENT_B_ID = "22222222-cccc-4ccc-cccc-000000000002";
const SIGNAL_B_ID = "22222222-5519-4519-5519-000000000002";
const ENTITY_B_ID = "22222222-e519-4519-e519-000000000002";
const INCIDENT_B_ID = "22222222-1519-4519-1519-000000000002";
const INVESTIGATION_B_ID = "22222222-9519-4519-9519-000000000002";
const REPORT_B_ID = "22222222-7519-4519-7519-000000000002";

// Phase B fixtures (added 2026-05-19 with the client_assets /
// site_audits / site_observations RLS hardening — migration
// 20260519170000_tighten_rls_client_assets_site_audits.sql).
const ASSET_A_ID = "11111111-a55e-4a55-aa55-000000000001";
const ASSET_B_ID = "22222222-a55e-4a55-aa55-000000000002";
const AUDIT_A_ID = "11111111-a3da-4a3d-aa3d-000000000001";
const AUDIT_B_ID = "22222222-a3da-4a3d-aa3d-000000000002";
const OBSERVATION_A_ID = "11111111-0b53-40b5-a0b5-000000000001";
const OBSERVATION_B_ID = "22222222-0b53-40b5-a0b5-000000000002";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const USER_A_EMAIL = process.env.TEST_INVARIANT_USER_A_EMAIL;
const USER_A_PASSWORD = process.env.TEST_INVARIANT_USER_A_PASSWORD;
const USER_B_EMAIL = process.env.TEST_INVARIANT_USER_B_EMAIL;
const USER_B_PASSWORD = process.env.TEST_INVARIANT_USER_B_PASSWORD;

const isCI = process.env.CI === "true";
const haveAllEnv =
  !!SUPABASE_URL &&
  !!SUPABASE_ANON_KEY &&
  !!USER_A_EMAIL &&
  !!USER_A_PASSWORD &&
  !!USER_B_EMAIL &&
  !!USER_B_PASSWORD;

// In CI we MUST run this test — fail loudly if secrets missing.
// Locally, allow skipping (a developer running `npm test` shouldn't
// need to hand-configure prod credentials).
if (isCI && !haveAllEnv) {
  describe("Tenant Isolation Invariant", () => {
    it("FATAL: required secrets missing in CI", () => {
      throw new Error(
        "Tenant isolation invariant test requires TEST_INVARIANT_USER_A_EMAIL, " +
          "TEST_INVARIANT_USER_A_PASSWORD, TEST_INVARIANT_USER_B_EMAIL, " +
          "TEST_INVARIANT_USER_B_PASSWORD, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY. " +
          "This test is a load-bearing security gate; missing secrets is a CI " +
          "configuration error, not a reason to skip.",
      );
    });
  });
} else {
  describe.skipIf(!haveAllEnv)("Tenant Isolation Invariant", () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    beforeAll(async () => {
      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: errA } = await clientA.auth.signInWithPassword({
        email: USER_A_EMAIL!,
        password: USER_A_PASSWORD!,
      });
      if (errA) {
        throw new Error(
          `User A sign-in failed (${errA.status ?? "?"}): ${errA.message}. ` +
            `Check TEST_INVARIANT_USER_A_* secrets and that ` +
            `setup-invariant-users.mjs has been run.`,
        );
      }
      const { error: errB } = await clientB.auth.signInWithPassword({
        email: USER_B_EMAIL!,
        password: USER_B_PASSWORD!,
      });
      if (errB) {
        throw new Error(
          `User B sign-in failed (${errB.status ?? "?"}): ${errB.message}.`,
        );
      }
    });

    afterAll(async () => {
      // Be polite — release the JWTs we acquired.
      await clientA?.auth.signOut();
      await clientB?.auth.signOut();
    });

    // ── DIRECTION 1: User A must not see Tenant B data ──────────
    describe("User A (tenant A analyst) cannot retrieve Tenant B data", () => {
      it("signals: tenant_id=B → 0 rows", async () => {
        const { data, error } = await clientA
          .from("signals")
          .select("id")
          .eq("tenant_id", TENANT_B_ID);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("signals: client_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("signals")
          .select("id")
          .eq("client_id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });

      it("signals: lookup by known tenant B signal id → 0 rows", async () => {
        const { data } = await clientA
          .from("signals")
          .select("id")
          .eq("id", SIGNAL_B_ID);
        expect(data).toEqual([]);
      });

      it("clients: tenant B client by id → 0 rows", async () => {
        const { data } = await clientA
          .from("clients")
          .select("id")
          .eq("id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });

      it("entities: tenant_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("entities")
          .select("id")
          .eq("tenant_id", TENANT_B_ID);
        expect(data).toEqual([]);
      });

      it("entities: lookup by known tenant B entity id → 0 rows", async () => {
        const { data } = await clientA
          .from("entities")
          .select("id")
          .eq("id", ENTITY_B_ID);
        expect(data).toEqual([]);
      });

      it("incidents: tenant_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("incidents")
          .select("id")
          .eq("tenant_id", TENANT_B_ID);
        expect(data).toEqual([]);
      });

      it("incidents: lookup by known tenant B incident id → 0 rows", async () => {
        const { data } = await clientA
          .from("incidents")
          .select("id")
          .eq("id", INCIDENT_B_ID);
        expect(data).toEqual([]);
      });

      it("investigations: client_id=B (investigations has no tenant_id col) → 0 rows", async () => {
        const { data } = await clientA
          .from("investigations")
          .select("id")
          .eq("client_id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });

      it("investigations: lookup by known tenant B investigation id → 0 rows", async () => {
        const { data } = await clientA
          .from("investigations")
          .select("id")
          .eq("id", INVESTIGATION_B_ID);
        expect(data).toEqual([]);
      });

      it("reports: tenant_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("reports")
          .select("id")
          .eq("tenant_id", TENANT_B_ID);
        expect(data).toEqual([]);
      });

      it("reports: lookup by known tenant B report id → 0 rows", async () => {
        const { data } = await clientA
          .from("reports")
          .select("id")
          .eq("id", REPORT_B_ID);
        expect(data).toEqual([]);
      });

      // Phase B tables — added 2026-05-19 when client_assets,
      // site_audits, and site_observations were hardened from
      // FOR SELECT TO authenticated USING (true) to the same
      // tenant-scoped pattern as the rows above.
      it("client_assets: client_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("client_assets")
          .select("id")
          .eq("client_id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });

      it("client_assets: lookup by known tenant B asset id → 0 rows", async () => {
        const { data } = await clientA
          .from("client_assets")
          .select("id")
          .eq("id", ASSET_B_ID);
        expect(data).toEqual([]);
      });

      it("site_audits: client_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("site_audits")
          .select("id")
          .eq("client_id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });

      it("site_audits: lookup by known tenant B audit id → 0 rows", async () => {
        const { data } = await clientA
          .from("site_audits")
          .select("id")
          .eq("id", AUDIT_B_ID);
        expect(data).toEqual([]);
      });

      it("site_observations: by audit_id=B → 0 rows", async () => {
        const { data } = await clientA
          .from("site_observations")
          .select("id")
          .eq("audit_id", AUDIT_B_ID);
        expect(data).toEqual([]);
      });

      it("site_observations: lookup by known tenant B observation id → 0 rows", async () => {
        const { data } = await clientA
          .from("site_observations")
          .select("id")
          .eq("id", OBSERVATION_B_ID);
        expect(data).toEqual([]);
      });
    });

    // ── DIRECTION 2: User B must not see Tenant A data ──────────
    describe("User B (tenant B analyst) cannot retrieve Tenant A data", () => {
      it("signals: tenant_id=A → 0 rows", async () => {
        const { data } = await clientB
          .from("signals")
          .select("id")
          .eq("tenant_id", TENANT_A_ID);
        expect(data).toEqual([]);
      });

      it("clients: tenant A client by id → 0 rows", async () => {
        const { data } = await clientB
          .from("clients")
          .select("id")
          .eq("id", CLIENT_A_ID);
        expect(data).toEqual([]);
      });

      it("entities: tenant_id=A → 0 rows", async () => {
        const { data } = await clientB
          .from("entities")
          .select("id")
          .eq("tenant_id", TENANT_A_ID);
        expect(data).toEqual([]);
      });

      it("investigations: client_id=A → 0 rows", async () => {
        const { data } = await clientB
          .from("investigations")
          .select("id")
          .eq("client_id", CLIENT_A_ID);
        expect(data).toEqual([]);
      });

      it("reports: tenant_id=A → 0 rows", async () => {
        const { data } = await clientB
          .from("reports")
          .select("id")
          .eq("tenant_id", TENANT_A_ID);
        expect(data).toEqual([]);
      });

      it("client_assets: lookup by known tenant A asset id → 0 rows", async () => {
        const { data } = await clientB
          .from("client_assets")
          .select("id")
          .eq("id", ASSET_A_ID);
        expect(data).toEqual([]);
      });

      it("site_audits: lookup by known tenant A audit id → 0 rows", async () => {
        const { data } = await clientB
          .from("site_audits")
          .select("id")
          .eq("id", AUDIT_A_ID);
        expect(data).toEqual([]);
      });

      it("site_observations: lookup by known tenant A observation id → 0 rows", async () => {
        const { data } = await clientB
          .from("site_observations")
          .select("id")
          .eq("id", OBSERVATION_A_ID);
        expect(data).toEqual([]);
      });
    });

    // ── POSITIVE ASSERTIONS — guard against false-negative test ─
    // If our isolation policies are TOO restrictive, the test would
    // pass while breaking legitimate access. These checks confirm
    // each fixture user CAN see their own tenant's data — so a
    // green test means "isolation works AND own-tenant access works."
    describe("Positive assertion — fixture users CAN see their own tenant", () => {
      it("User A sees ≥1 tenant A signal", async () => {
        const { data } = await clientA
          .from("signals")
          .select("id")
          .eq("tenant_id", TENANT_A_ID);
        expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      it("User A sees the tenant A client by id", async () => {
        const { data } = await clientA
          .from("clients")
          .select("id, name")
          .eq("id", CLIENT_A_ID);
        expect(data?.length).toBe(1);
        expect(data?.[0]?.name).toBe("_invariant_client_a");
      });

      it("User B sees ≥1 tenant B signal", async () => {
        const { data } = await clientB
          .from("signals")
          .select("id")
          .eq("tenant_id", TENANT_B_ID);
        expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      it("User B sees the tenant B client by id", async () => {
        const { data } = await clientB
          .from("clients")
          .select("id, name")
          .eq("id", CLIENT_B_ID);
        expect(data?.length).toBe(1);
        expect(data?.[0]?.name).toBe("_invariant_client_b");
      });

      // Phase B positive coverage — confirms the new RLS isn't
      // over-restrictive. If any of these regressed to 0 rows the
      // fix has gone too far.
      it("User A sees the tenant A asset by id", async () => {
        const { data } = await clientA
          .from("client_assets")
          .select("id, name")
          .eq("id", ASSET_A_ID);
        expect(data?.length).toBe(1);
        expect(data?.[0]?.name).toBe("_invariant_asset_a");
      });

      it("User A sees the tenant A audit by id", async () => {
        const { data } = await clientA
          .from("site_audits")
          .select("id")
          .eq("id", AUDIT_A_ID);
        expect(data?.length).toBe(1);
      });

      it("User A sees the tenant A observation by id", async () => {
        const { data } = await clientA
          .from("site_observations")
          .select("id")
          .eq("id", OBSERVATION_A_ID);
        expect(data?.length).toBe(1);
      });

      it("User B sees the tenant B asset by id", async () => {
        const { data } = await clientB
          .from("client_assets")
          .select("id, name")
          .eq("id", ASSET_B_ID);
        expect(data?.length).toBe(1);
        expect(data?.[0]?.name).toBe("_invariant_asset_b");
      });

      it("User B sees the tenant B audit by id", async () => {
        const { data } = await clientB
          .from("site_audits")
          .select("id")
          .eq("id", AUDIT_B_ID);
        expect(data?.length).toBe(1);
      });

      it("User B sees the tenant B observation by id", async () => {
        const { data } = await clientB
          .from("site_observations")
          .select("id")
          .eq("id", OBSERVATION_B_ID);
        expect(data?.length).toBe(1);
      });
    });

    // ── EXPLICIT NAMED ASSERTION — the canonical Petronas test ──
    // Symbolically, tenant B stands for "the other tenant" (the
    // role Petronas played in the original 2026-05-18 contamination
    // report). This block exists as a documented, named guarantee
    // that the regression mode that triggered this whole sweep
    // cannot recur.
    describe("Petronas-style cross-tenant denial (the named regression gate)", () => {
      it("User A cannot read the named Tenant B client (Petronas-equivalent fixture)", async () => {
        const { data } = await clientA
          .from("clients")
          .select("id, name")
          .eq("id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });

      it("User A cannot read any signal belonging to the Petronas-equivalent client", async () => {
        const { data } = await clientA
          .from("signals")
          .select("id")
          .eq("client_id", CLIENT_B_ID);
        expect(data).toEqual([]);
      });
    });
  });
}
