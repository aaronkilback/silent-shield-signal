import { test, expect } from './fixtures/auth';

/**
 * #147 — Regression test for the 2026-05-21 prod hang.
 *
 * Root cause: ProtectedRoute.tsx:195 `OnboardingChecks` had
 * `if (!currentTenant) return <Loader>` unconditionally. Super_admin with
 * no fortress_current_tenant_id in localStorage and isAllTenantsView=false
 * hit this loader and spun forever (because useTenant.tsx hydration
 * intentionally leaves currentTenant=null for super_admin with no saved
 * selection — the "explicit no-selection" operator-integrity rule from
 * the 2026-05-19 Bug 2 sweep).
 *
 * Fix: added `(isSuperAdmin && !currentTenant)` to platformAdminMode
 * (commit 69419afe), restoring #81's intent.
 *
 * This test reproduces the exact starting condition and asserts the app
 * renders normally instead of an infinite spinner.
 */

test.describe('Super_admin bootstrap with no tenant selection', () => {
  test('renders platform-admin mode within 5s when tenant scope is unset', async ({
    authedPage: page,
  }) => {
    // Clear the two localStorage keys that useTenant rehydrates from.
    // This puts a super_admin into the "explicit no-selection" state
    // that hit the regression.
    await page.evaluate(() => {
      localStorage.removeItem('fortress_current_tenant_id');
      localStorage.removeItem('fortress_all_tenants_view');
    });

    // Hard reload so hydration runs fresh.
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Assert no infinite spinner: a top-level platform surface must
    // render within 5 seconds. We probe for the MinimalHeader (always
    // mounted on `/`) and the dashboard AEGIS surface.
    await expect(
      page.getByRole('button', { name: /Pages/i })
    ).toBeVisible({ timeout: 5_000 });

    // The env badge is a stable platform-rendered element that proves the app
    // exited the loader-state. Label is env-dependent (STAGING on staging, PRODUCTION
    // on prod) — match any. (#57) Its label comes from a DB useQuery (environment_config),
    // so give it the suite's standard 10s DB-backed timeout (not 5s) — a cold-preview
    // query settle must not manufacture a red. RLS confirms authenticated read (qual=true). (#58)
    await expect(page.getByText(/PRODUCTION|STAGING|TEST/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Negative assertion: prove the AEGIS composer rendered (i.e. NOT stuck in the
    // OnboardingChecks loader — the #147 intent). The composer input is now a shadcn
    // <Input> (typeless <input>), no longer a <textarea>/input[type=text] — match its
    // stable placeholder instead. Fast, no-DB element → keep 5s. (#58 selector update)
    await expect(
      page.getByPlaceholder(/Ask AEGIS anything/i)
    ).toBeVisible({ timeout: 5_000 });
  });

  test('renders correctly after explicit tenant-view clear', async ({
    authedPage: page,
  }) => {
    // Second pass: clear both keys explicitly and a third "stale tenant"
    // pointer that would have triggered the same code path.
    await page.evaluate(() => {
      localStorage.removeItem('fortress_current_tenant_id');
      localStorage.removeItem('fortress_all_tenants_view');
      // Inject a stale (non-existent) tenant id to confirm the
      // hydration heuristic still leaves currentTenant=null without
      // crashing.
      localStorage.setItem(
        'fortress_current_tenant_id',
        '00000000-0000-0000-0000-deadbeef0000'
      );
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // DB-backed env badge → 10s (see :22 above). (#58)
    await expect(page.getByText(/PRODUCTION|STAGING|TEST/).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
