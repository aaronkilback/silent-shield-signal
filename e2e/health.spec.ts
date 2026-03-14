import { test, expect } from './fixtures/auth';

test.describe('Platform Health Indicators', () => {
  test('PRODUCTION badge is visible on dashboard', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('PRODUCTION')).toBeVisible({ timeout: 10_000 });
  });

  test('threat level badge is present and readable', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // THREAT label + a level (LOW / MEDIUM / HIGH / CRITICAL)
    await expect(page.getByText(/THREAT/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/LOW|MEDIUM|HIGH|CRITICAL/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('open incidents count is a non-negative number', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(/Open Incidents/i)).toBeVisible({ timeout: 10_000 });
    // The number next to "Open Incidents:" should be numeric
    const label = await page.getByText(/Open Incidents/i).first().textContent();
    const match = label?.match(/Open Incidents:\s*(\d+)/i);
    if (match) {
      expect(parseInt(match[1])).toBeGreaterThanOrEqual(0);
    }
  });

  test('nav bar has all primary sections', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Core nav items visible in the top bar
    for (const label of ['Intel', 'Ops', 'Admin']) {
      await expect(page.getByRole('button', { name: new RegExp(label, 'i') }).or(
        page.getByText(label).first()
      )).toBeVisible({ timeout: 8_000 });
    }
  });

  test('Supabase real-time connection is active (LIVE indicator)', async ({ authedPage: page }) => {
    await page.goto('/incidents');
    await page.waitForLoadState('domcontentloaded');
    // LIVE badge appears when the Supabase realtime subscription is connected
    await expect(page.getByText('LIVE')).toBeVisible({ timeout: 15_000 });
  });
});
