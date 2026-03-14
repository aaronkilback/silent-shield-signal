import { test, expect } from './fixtures/auth';

test.describe('Incident Management', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/incidents');
    await page.waitForLoadState('domcontentloaded');
    // Wait for the stats cards to populate (they query Supabase)
    await expect(page.getByText(/Total Incidents/i)).toBeVisible({ timeout: 12_000 });
  });

  test('stats cards render with numeric values', async ({ authedPage: page }) => {
    // All 4 stat cards must be visible
    await expect(page.getByText(/Total Incidents/i)).toBeVisible();
    await expect(page.getByText(/^Open$/i)).toBeVisible();
    await expect(page.getByText(/Acknowledged/i)).toBeVisible();
    await expect(page.getByText(/Critical/i)).toBeVisible();

    // Each card should contain at least one number
    const cards = page.locator('text=/^\d+$/').first();
    await expect(cards).toBeVisible({ timeout: 10_000 });
  });

  test('incident list renders at least one row', async ({ authedPage: page }) => {
    // The incident table / list should have data
    const rows = page.getByRole('row').or(
      page.locator('[class*="incident-row"], [class*="table"] tr, [data-testid*="incident"]')
    );
    await expect(rows.first()).toBeVisible({ timeout: 12_000 });
  });

  test('search input is interactive', async ({ authedPage: page }) => {
    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();
    await search.fill('test-search-query');
    await expect(search).toHaveValue('test-search-query');
    // Clear it
    await search.clear();
    await expect(search).toHaveValue('');
  });

  test('All Status filter dropdown is visible and clickable', async ({ authedPage: page }) => {
    const filter = page.getByRole('combobox').or(page.getByText(/All Status/i)).first();
    await expect(filter).toBeVisible();
    await filter.click();
    // Some option should appear after click
    await expect(page.getByRole('option').or(page.getByRole('menuitem')).first()).toBeVisible({ timeout: 5_000 });
  });
});
