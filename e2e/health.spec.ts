import { test, expect } from './fixtures/auth';

test.describe('Platform Health Indicators', () => {
  test('PRODUCTION badge is visible on dashboard', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('PRODUCTION')).toBeVisible({ timeout: 10_000 });
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
    // "Open Incidents: 30" style label must be present
    await expect(page.getByText(/Open Incidents/i)).toBeVisible({ timeout: 10_000 });
  });

  test('primary nav sections are present', async ({ authedPage: page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    for (const label of ['Intel', 'Ops', 'Admin']) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 8_000 });
    }
  });

  test('LIVE realtime indicator on incidents page', async ({ authedPage: page }) => {
    await page.goto('/incidents', { waitUntil: 'domcontentloaded' });
    // Supabase realtime subscription badge — allows up to 15s to connect
    await expect(page.getByText('LIVE')).toBeVisible({ timeout: 15_000 });
  });
});
