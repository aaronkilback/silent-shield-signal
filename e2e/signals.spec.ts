import { test, expect } from './fixtures/auth';

test.describe('Signals & Intelligence', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/signals');
    await expect(page.getByRole('heading', { name: 'Signals & Intelligence' })).toBeVisible({ timeout: 15_000 });
  });

  test('Signal Feed tab is visible', async ({ authedPage: page }) => {
    await expect(page.getByRole('tab', { name: 'Signal Feed' })).toBeVisible();
  });

  test('signal history sub-tabs render', async ({ authedPage: page }) => {
    // Use role=tab to avoid matching text in paragraph/description elements
    await expect(page.getByRole('tab', { name: 'Recent' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Historical' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
  });

  test('Unmatched tab is clickable without crashing', async ({ authedPage: page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => {
      if (!e.message.includes('ResizeObserver')) jsErrors.push(e.message);
    });
    // Use the tab trigger directly by its id to avoid strict mode ambiguity
    await page.locator('[id*="trigger-unmatched"]').first().click();
    await page.waitForLoadState('domcontentloaded');
    expect(jsErrors, 'JS errors after tab click').toHaveLength(0);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('[object Object]');
  });

  test('Client Filter is visible', async ({ authedPage: page }) => {
    await expect(page.getByText('Client Filter')).toBeVisible();
  });
});
