import { test, expect } from '@playwright/test';

test.describe('Fortress Auth', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/auth');
    // Page should load without error
    await expect(page).not.toHaveTitle(/404|Not Found|Error/i);
    // Should have an email input
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible({ timeout: 10000 });
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/auth');

    // Fill in credentials from environment
    await page.locator('input[type="email"], input[name="email"]').fill(process.env.TEST_USER_EMAIL || '');
    await page.locator('input[type="password"], input[name="password"]').fill(process.env.TEST_USER_PASSWORD || '');

    // Submit
    await page.locator('button[type="submit"]').click();

    // Should redirect away from /auth within 15s
    await expect(page).not.toHaveURL(/\/auth/, { timeout: 15000 });

    // Dashboard should have the Fortress header
    await expect(page.locator('text=Fortress AI').or(page.locator('text=THREAT').or(page.locator('[data-testid="dashboard"]')))).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Fortress App Health', () => {
  test('app is reachable and loads', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Fortress/i, { timeout: 10000 });
  });
});
