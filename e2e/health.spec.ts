import { test, expect } from './fixtures/auth';

test.describe('Platform Health Indicators', () => {
  test('PRODUCTION badge is visible on dashboard', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('PRODUCTION').first()).toBeVisible({ timeout: 10_000 });
  });

  test('threat level badge shows a known level', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('THREAT')).toBeVisible({ timeout: 10_000 });
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
