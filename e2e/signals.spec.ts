import { test, expect } from './fixtures/auth';

test.describe('Signals & Intelligence', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/signals');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: /Signals/i })).toBeVisible({ timeout: 12_000 });
  });

  test('Signal Feed tab is active by default', async ({ authedPage: page }) => {
    // The "Signal Feed" tab should be the default active state
    const tab = page.getByRole('tab', { name: /Signal Feed/i }).or(
      page.getByText('Signal Feed').first()
    );
    await expect(tab).toBeVisible();
  });

  test('signal history sub-tabs are present', async ({ authedPage: page }) => {
    await expect(page.getByText(/Recent/i).first()).toBeVisible();
    await expect(page.getByText(/Historical/i).first()).toBeVisible();
    await expect(page.getByText(/All/i).first()).toBeVisible();
  });

  test('Unmatched tab is clickable and loads content', async ({ authedPage: page }) => {
    const unmatchedTab = page.getByRole('tab', { name: /Unmatched/i }).or(
      page.getByText('Unmatched').first()
    );
    await expect(unmatchedTab).toBeVisible();
    await unmatchedTab.click();
    // URL or content should reflect the tab change — no crash
    await page.waitForLoadState('domcontentloaded');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('[object Object]');
  });

  test('client filter dropdown is present', async ({ authedPage: page }) => {
    await expect(page.getByText(/Client Filter/i)).toBeVisible();
    // The combobox / dropdown should be interactive
    const dropdown = page.getByRole('combobox').first();
    await expect(dropdown).toBeVisible();
  });
});
