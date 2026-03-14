import { test, expect } from './fixtures/auth';

test.describe('Signals & Intelligence', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/signals', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Signals & Intelligence' })).toBeVisible({ timeout: 12_000 });
  });

  test('Signal Feed tab is present', async ({ authedPage: page }) => {
    await expect(page.getByRole('tab', { name: 'Signal Feed' })
      .or(page.getByText('Signal Feed'))).toBeVisible();
  });

  test('signal history sub-tabs render', async ({ authedPage: page }) => {
    await expect(page.getByText('Recent')).toBeVisible();
    await expect(page.getByText('Historical')).toBeVisible();
    await expect(page.getByText('All')).toBeVisible();
  });

  test('Unmatched tab is clickable without crashing', async ({ authedPage: page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => {
      if (!e.message.includes('ResizeObserver')) jsErrors.push(e.message);
    });
    await page.getByRole('tab', { name: 'Unmatched' })
      .or(page.getByText('Unmatched').first())
      .click();
    await page.waitForLoadState('domcontentloaded');
    expect(jsErrors, 'JS errors after tab click').toHaveLength(0);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('[object Object]');
  });

  test('Client Filter section is visible', async ({ authedPage: page }) => {
    await expect(page.getByText('Client Filter')).toBeVisible();
  });
});
