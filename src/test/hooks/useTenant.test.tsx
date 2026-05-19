/**
 * useTenant — Bug 2 deterministic hydration regression test
 *
 * INVARIANT (operator integrity):
 *   When a super_admin selects a tenant view and refreshes the page,
 *   the selection must survive the refresh AND the scope indicator
 *   must remain visible. The previous implementation could race the
 *   super-admin probe vs. the tenants fetch and silently land on
 *   tenants[0] instead of the saved selection — looking to the
 *   operator like a revert to global scope.
 *
 * What this test gates against:
 *   1. Race: when the tenants query resolves BEFORE the super-admin
 *      probe, rehydration must still pick the saved tenant (not
 *      tenants[0]).
 *   2. Fail-safe: getFilterTenantIds() returns [] while hydrating
 *      AND for a super_admin with no explicit selection. NEVER falls
 *      back to "all of the user's accessible tenants" — that was the
 *      silent global-scope path closed in the 2026-05-19 sweep.
 *   3. Banner: the super-admin scope indicator renders whenever a
 *      super_admin is in a tenant view, even if they own the tenant.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, render, waitFor, act, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// vi.mock() is hoisted, so shared mock fns must come from vi.hoisted.
const mocks = vi.hoisted(() => ({
  authState: {
    user: { id: "super-1", email: "super@example.test" } as
      | { id: string; email: string }
      | null,
  },
  userRolesMaybeSingle: vi.fn(),
  functionsInvoke: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mocks.authState.user,
    session: mocks.authState.user ? { access_token: "test-jwt" } : null,
    loading: false,
  }),
}));

// Self-contained supabase mock for this file. Each test wires its own
// `from('user_roles')` and `functions.invoke` resolution timing so we
// can probe the race deterministically.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: mocks.userRolesMaybeSingle,
          }),
        }),
      }),
    }),
    functions: {
      invoke: mocks.functionsInvoke,
    },
  },
}));

const { userRolesMaybeSingle, functionsInvoke } = mocks;

// Import AFTER mocks are wired.
import { TenantProvider, useTenant } from "@/hooks/useTenant";
import { PlatformAdminBanner } from "@/components/PlatformAdminBanner";

function makeTenant(id: string, name: string, opts: Partial<{ access_mode: string }> = {}) {
  return {
    id,
    name,
    status: "active",
    settings: {},
    tenant_role: "admin",
    role: "admin",
    platform_access: true,
    access_mode: opts.access_mode ?? "tenant_member_plus_platform_admin",
    can_impersonate: true,
    joined_at: "2026-01-01T00:00:00Z",
  };
}

const TENANT_PETRONAS = makeTenant("petronas-aaaa", "Petronas");
const TENANT_CRT = makeTenant("crt-bbbb", "CRT");

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TenantProvider>{children}</TenantProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.authState.user = { id: "super-1", email: "super@example.test" };
  userRolesMaybeSingle.mockReset();
  functionsInvoke.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTenant — deterministic hydration", () => {
  it("RACE: tenants resolve before super-admin probe → still rehydrates the saved tenant (not tenants[0])", async () => {
    // The exact symptom of Bug 2. Operator selected CRT (NOT first
    // in the tenants array), refreshed, and the old code silently
    // returned them to Petronas. This must not happen again.
    localStorage.setItem("fortress_current_tenant_id", TENANT_CRT.id);

    const sa = deferred<{ data: { role: string } | null; error: null }>();
    const t = deferred<{ data: { tenants: ReturnType<typeof makeTenant>[]; has_tenants: boolean }; error: null }>();
    userRolesMaybeSingle.mockReturnValue(sa.promise);
    functionsInvoke.mockReturnValue(t.promise);

    const { result } = renderHook(() => useTenant(), { wrapper: makeWrapper() });

    // Pre-resolution: fail safe. No global fallback.
    expect(result.current.isHydrating).toBe(true);
    expect(result.current.currentTenant).toBeNull();
    expect(result.current.getFilterTenantIds()).toEqual([]);

    // Tenants resolve first (the race).
    await act(async () => {
      t.resolve({
        data: { tenants: [TENANT_PETRONAS, TENANT_CRT], has_tenants: true },
        error: null,
      });
      await Promise.resolve();
    });

    // Still hydrating because super-admin status unknown — must NOT
    // have taken the regular-user branch yet.
    expect(result.current.isHydrating).toBe(true);
    expect(result.current.currentTenant).toBeNull();

    // Super-admin probe resolves "yes" (after tenants — the bug path).
    await act(async () => {
      sa.resolve({ data: { role: "super_admin" }, error: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    // CRITICAL — rehydrate to the saved tenant, not tenants[0].
    expect(result.current.currentTenant?.id).toBe(TENANT_CRT.id);
    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.hasTenantSelection).toBe(true);
    expect(result.current.isAllTenantsView).toBe(false);
    expect(result.current.getFilterTenantIds()).toEqual([TENANT_CRT.id]);
  });

  it("FAIL-SAFE: super_admin with no selection → getFilterTenantIds() returns [] (never the user's tenants)", async () => {
    // No localStorage hint. Super_admin is signed in. The previous
    // implementation returned tenants.map(t => t.id) — silently
    // showing every tenant the user could touch. The new contract
    // is [] (deny until explicit selection).
    userRolesMaybeSingle.mockResolvedValue({ data: { role: "super_admin" }, error: null });
    functionsInvoke.mockResolvedValue({
      data: { tenants: [TENANT_PETRONAS, TENANT_CRT], has_tenants: true },
      error: null,
    });

    const { result } = renderHook(() => useTenant(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.currentTenant).toBeNull();
    expect(result.current.hasTenantSelection).toBe(false);
    expect(result.current.getFilterTenantIds()).toEqual([]);
  });

  it("FAIL-SAFE: still hydrating → getFilterTenantIds() returns [] (never global, never partial)", async () => {
    // Test the operator-integrity rule on its own: while we don't
    // yet know what scope we're in, deny everything.
    userRolesMaybeSingle.mockReturnValue(new Promise(() => {})); // never resolves
    functionsInvoke.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useTenant(), { wrapper: makeWrapper() });

    expect(result.current.isHydrating).toBe(true);
    expect(result.current.getFilterTenantIds()).toEqual([]);
  });

  it("regular user rehydrates saved selection, defaults to tenants[0] if none saved", async () => {
    userRolesMaybeSingle.mockResolvedValue({ data: null, error: null });
    functionsInvoke.mockResolvedValue({
      data: { tenants: [TENANT_PETRONAS, TENANT_CRT], has_tenants: true },
      error: null,
    });

    const { result } = renderHook(() => useTenant(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    expect(result.current.isSuperAdmin).toBe(false);
    expect(result.current.currentTenant?.id).toBe(TENANT_PETRONAS.id);
    expect(result.current.hasTenantSelection).toBe(true);
    expect(result.current.getFilterTenantIds()).toEqual([TENANT_PETRONAS.id]);
    expect(localStorage.getItem("fortress_current_tenant_id")).toBe(TENANT_PETRONAS.id);
  });

  it("AllTenants view rehydrates after refresh and getFilterTenantIds() returns null", async () => {
    localStorage.setItem("fortress_all_tenants_view", "true");
    userRolesMaybeSingle.mockResolvedValue({ data: { role: "super_admin" }, error: null });
    functionsInvoke.mockResolvedValue({
      data: { tenants: [TENANT_PETRONAS, TENANT_CRT], has_tenants: true },
      error: null,
    });

    const { result } = renderHook(() => useTenant(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    expect(result.current.isAllTenantsView).toBe(true);
    expect(result.current.hasTenantSelection).toBe(true);
    expect(result.current.getFilterTenantIds()).toBeNull();
  });

  it("on logout, hydration latch resets so next sign-in re-hydrates", async () => {
    userRolesMaybeSingle.mockResolvedValue({ data: { role: "super_admin" }, error: null });
    functionsInvoke.mockResolvedValue({
      data: { tenants: [TENANT_PETRONAS], has_tenants: true },
      error: null,
    });
    localStorage.setItem("fortress_current_tenant_id", TENANT_PETRONAS.id);

    const { result, rerender } = renderHook(() => useTenant(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isHydrating).toBe(false));
    expect(result.current.currentTenant?.id).toBe(TENANT_PETRONAS.id);

    // Simulate logout. Hydration latch should clear so a future
    // sign-in re-runs the hydration pass and doesn't reuse stale
    // local state. (We don't simulate the re-sign-in here — just
    // verify the post-logout reset.)
    await act(async () => {
      mocks.authState.user = null;
      rerender();
      await Promise.resolve();
    });

    expect(result.current.currentTenant).toBeNull();
    expect(result.current.hasTenantSelection).toBe(false);
    expect(localStorage.getItem("fortress_current_tenant_id")).toBeNull();
  });
});

describe("PlatformAdminBanner — always-visible super-admin scope indicator", () => {
  it("renders when super_admin views a tenant they own (the case the old banner missed)", async () => {
    localStorage.setItem("fortress_current_tenant_id", TENANT_CRT.id);
    userRolesMaybeSingle.mockResolvedValue({ data: { role: "super_admin" }, error: null });
    functionsInvoke.mockResolvedValue({
      data: {
        // access_mode marks the operator as a tenant member — the
        // OLD banner would have hidden itself in this case.
        tenants: [makeTenant(TENANT_CRT.id, "CRT", { access_mode: "tenant_member_plus_platform_admin" })],
        has_tenants: true,
      },
      error: null,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <PlatformAdminBanner />
      </Wrapper>,
    );

    const banner = await screen.findByTestId("super-admin-scope-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/Super-admin scope/);
    expect(banner.textContent).toMatch(/CRT/);
    // The "not a member" sub-text must NOT appear when the operator
    // is a member of the tenant.
    expect(banner.textContent).not.toMatch(/not a tenant member/);
  });

  it("does not render for a non-super-admin user", async () => {
    localStorage.setItem("fortress_current_tenant_id", TENANT_PETRONAS.id);
    userRolesMaybeSingle.mockResolvedValue({ data: null, error: null });
    functionsInvoke.mockResolvedValue({
      data: { tenants: [TENANT_PETRONAS], has_tenants: true },
      error: null,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <PlatformAdminBanner />
      </Wrapper>,
    );

    // Give the queries a chance to resolve, then assert nothing.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("super-admin-scope-banner")).toBeNull();
  });

  it("renders with ALL TENANTS label when super_admin is in all-tenants view", async () => {
    localStorage.setItem("fortress_all_tenants_view", "true");
    userRolesMaybeSingle.mockResolvedValue({ data: { role: "super_admin" }, error: null });
    functionsInvoke.mockResolvedValue({
      data: { tenants: [TENANT_PETRONAS, TENANT_CRT], has_tenants: true },
      error: null,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <PlatformAdminBanner />
      </Wrapper>,
    );

    const banner = await screen.findByTestId("super-admin-scope-banner");
    expect(banner.textContent).toMatch(/ALL TENANTS/);
  });
});
