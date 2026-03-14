import { test, expect } from '@playwright/test';

/**
 * Auth spec — only tests that actually exercise the login UI.
 * Everything else uses the API fixture (authedPage) to skip the form.
 */
test.describe('Authentication UI', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session so we always start unauthenticated
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.includes('auth-token') || k.includes('supabase'))
        .forEach(k => localStorage.removeItem(k));
    });
  });

  test('unauthenticated user is redirected to /auth', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
  });

  test('login page renders email + password inputs and submit button', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|log in|continue/i })).toBeVisible();
  });

  test('wrong password shows an error message', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('textbox', { name: /email/i }).fill(process.env.TEST_USER_EMAIL!);
    await page.getByLabel(/password/i).fill('definitely-wrong-password-12345');
    await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
    // Should stay on /auth and show an error
    await expect(page).toHaveURL(/\/auth/, { timeout: 8_000 });
    await expect(
      page.getByText(/invalid|incorrect|wrong|error|credentials/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('valid credentials redirect to dashboard', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('textbox', { name: /email/i }).fill(process.env.TEST_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
    await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 15_000 });
    // Nav header confirms we're in the app
    await expect(page.getByText('Fortress AI').first()).toBeVisible({ timeout: 10_000 });
  });
});
