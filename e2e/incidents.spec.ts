import { test, expect } from './fixtures/auth';

test.describe('Incident Management', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/incidents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Incident Management')).toBeVisible({ timeout: 12_000 });
  });

  test('stat cards render with numbers', async ({ authedPage: page }) => {
    await expect(page.getByText('Total Incidents')).toBeVisible();
    await expect(page.getByText(/^Open$/)).toBeVisible();
    await expect(page.getByText('Acknowledged')).toBeVisible();
    await expect(page.getByText(/Critical/)).toBeVisible();
    // At least one numeric value present
    await expect(page.locator('text=/^\d+$/').first()).toBeVisible({ timeout: 10_000 });
  });

  test('search input accepts and clears text', async ({ authedPage: page }) => {
    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();
    await search.fill('test-query');
    await expect(search).toHaveValue('test-query');
    await search.clear();
    await expect(search).toHaveValue('');
  });

  test('All Status filter is visible', async ({ authedPage: page }) => {
    await expect(page.getByText('All Status')).toBeVisible();
  });

  test('All Priority filter is visible', async ({ authedPage: page }) => {
    await expect(page.getByText('All Priority')).toBeVisible();
  });

  test('client filter dropdown shows a selection', async ({ authedPage: page }) => {
    await expect(page.getByText('Client Filter')).toBeVisible();
  });
});
