import { test, expect } from './fixtures/auth';

test.describe('Platform Health Indicators', () => {
  test('environment badge is visible on dashboard', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // EnvironmentBadge label comes from environment_config.environment_name —
    // PRODUCTION on prod, STAGING on staging (where E2E runs). Assert the badge
    // renders regardless of env rather than hardcoding PRODUCTION. (#57)
    await expect(page.getByText(/PRODUCTION|STAGING|TEST/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('threat level badge shows a known level', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // #59: getByText('THREAT') (case-insensitive substring) matched 3 elements —
    // the ThreatStatusBar label, the "Threat Radar" nav button, and the assistant
    // intro text — a strict-mode violation. Scope to the exact status-bar label:
    // the DOM text is "Threat" (CSS-uppercased), so exact+case-sensitive isolates it.
    await expect(page.getByText('Threat', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('LOW').or(page.getByText('MEDIUM')).or(page.getByText('HIGH')).or(page.getByText('CRITICAL')).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('open incidents count is shown in status bar', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Open Incidents/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Pages navigation button is present in header', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Pages button opens the nav drawer; verifies header rendered fully
    await expect(page.getByRole('button', { name: /Pages/i })).toBeVisible({ timeout: 10_000 });
  });

  test('LIVE realtime indicator on incidents page', async ({ authedPage: page }) => {
    await page.goto('/incidents', { waitUntil: 'domcontentloaded' });
    // Supabase realtime subscription badge - allows up to 15s to connect
    await expect(page.getByText('LIVE')).toBeVisible({ timeout: 15_000 });
  });
});
