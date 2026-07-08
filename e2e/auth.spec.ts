import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';

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

  test('valid credentials + TOTP redirect away from /auth', async ({ page }) => {
    await page.locator('#email').fill(process.env.TEST_USER_EMAIL!);
    await page.locator('#password').fill(process.env.TEST_USER_PASSWORD!);
    await page.locator('button[type="submit"]').filter({ hasText: 'Sign In' }).first().click();

    // Main-lineage login ENFORCES MFA (Auth.tsx). _aegis_test_super has a verified
    // TOTP factor (enrolled once via scripts/setup-e2e-totp.mjs); complete the real
    // challenge with a code derived from E2E_TOTP_SECRET. This keeps MFA enforced and
    // the test honest to what real users do — rather than exempting the user (a security
    // exception). NOTE: covers the TOTP branch only; the SMS-MFA branch is impractical to
    // automate in CI (needs a phone/SMS receiver) — documented coverage gap. (#57 / #58)
    const otp = page.getByPlaceholder('000000');
    await otp.waitFor({ state: 'visible', timeout: 15_000 });
    await otp.fill(authenticator.generate(process.env.E2E_TOTP_SECRET!));
    await page.getByRole('button', { name: /^Verify$/ }).click();

    await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 15_000 });
    // Confirm the dashboard nav is present
    await expect(page.getByText('Fortress AI').first()).toBeVisible({ timeout: 10_000 });
  });
});
