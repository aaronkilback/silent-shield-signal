import { test, expect } from './fixtures/auth';

/**
 * Navigation spec — verifies every major route:
 * 1. Returns HTTP < 500
 * 2. Renders a page title / heading (not a blank screen)
 * 3. No unhandled JS errors thrown
 * 4. No raw "[object Object]" leaked to DOM
 *
 * Uses API auth fixture — no UI login on each test.
 */

const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/',                  heading: /Fortress AI|Aegis|Dashboard/i },
  { path: '/incidents',         heading: /Incident/i },
  { path: '/signals',           heading: /Signal/i },
  { path: '/clients',           heading: /Client|Pre-Qualification/i },
  { path: '/reports',           heading: /Report/i },
  { path: '/investigations',    heading: /Investigation/i },
  { path: '/knowledge-base',    heading: /Knowledge/i },
  { path: '/command-center',    heading: /Command/i },
  { path: '/threat-radar',      heading: /Threat|Radar/i },
  { path: '/intel',             heading: /Intel/i },
];

for (const { path, heading } of ROUTES) {
  test(`${path} loads without error`, async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto(path);

    // HTTP status must be < 500
    expect(response?.status() ?? 200).toBeLessThan(500);

    // Wait for content to settle
    await page.waitForLoadState('domcontentloaded');

    // At least one heading or the app title must match
    await expect(
      page.getByRole('heading', { name: heading }).or(page.getByText(heading)).first()
    ).toBeVisible({ timeout: 12_000 });

    // No raw object dumps in the visible text
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('[object Object]');

    // No unhandled JS errors
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
}
