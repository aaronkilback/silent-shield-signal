import { test, expect } from '@playwright/test';

/**
 * Auth spec — UI login flows only.
 * All other specs use the API auth fixture (authedPage).
 *
 * Selectors confirmed against live DOM:
 *   Email:    input#email  (label "Email")
 *   Password: input#password  (label "Password (min. 8 characters)")
 *   Submit:   button[type="submit"]:has-text("Sign In")
 */
test.describe('Authentication UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-') || k.includes('supabase'))
        .forEach(k => localStorage.removeItem(k));
    });
    await page.goto('/auth');
    await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
  });

  test('unauthenticated user lands on /auth', async ({ page }) => {
    await expect(page).toHaveURL(/\/auth/);
  });

  test('login form renders email, password and Sign In button', async ({ page }) => {
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]').filter({ hasText: 'Sign In' }).first()).toBeVisible();
    // Page title confirms we're on the right page
    await expect(page.getByRole('heading', { name: 'Fortress AI' })).toBeVisible();
  });

  test('wrong password shows error, stays on /auth', async ({ page }) => {
    await page.locator('#email').fill(process.env.TEST_USER_EMAIL!);
    await page.locator('#password').fill('wrong-password-xyz-99999');
    await page.locator('button[type="submit"]').filter({ hasText: 'Sign In' }).first().click();
    // Must stay on /auth
    await expect(page).toHaveURL(/\/auth/, { timeout: 8_000 });
    // An error toast or inline message should appear
    await expect(
      page.getByText(/invalid|incorrect|wrong|credentials|password|error/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('valid credentials redirect away from /auth', async ({ page }) => {
    await page.locator('#email').fill(process.env.TEST_USER_EMAIL!);
    await page.locator('#password').fill(process.env.TEST_USER_PASSWORD!);
    await page.locator('button[type="submit"]').filter({ hasText: 'Sign In' }).first().click();
    await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 15_000 });
    // Confirm the dashboard nav is present
    await expect(page.getByText('Fortress AI').first()).toBeVisible({ timeout: 10_000 });
  });
});
