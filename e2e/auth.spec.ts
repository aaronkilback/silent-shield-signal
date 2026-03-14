import { test, expect } from '@playwright/test';

test.describe('Fortress Auth', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/auth');
    await expect(page).not.toHaveTitle(/404|Not Found|Error/i);
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/auth');

    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.TEST_USER_EMAIL || '');
    await page.locator('input[type="password"], input[name="password"]').first().fill(process.env.TEST_USER_PASSWORD || '');
    await page.locator('button[type="submit"]').first().click();

    // Should redirect away from /auth within 15s
    await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 15000 });

    // Dashboard loaded - check for the nav header span (unique element)
    await expect(page.locator('span.font-semibold').filter({ hasText: 'Fortress AI' }).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Fortress App Health', () => {
  test('app is reachable and loads', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Fortress/i, { timeout: 10000 });
  });
});
