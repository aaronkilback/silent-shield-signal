import { test, expect } from './fixtures/auth';

/**
 * Navigation smoke tests — every major route must:
 * 1. Return HTTP < 500
 * 2. Show a recognisable heading within 12s
 * 3. Contain no [object Object] in the DOM
 * 4. Throw no unhandled JS errors (except benign ResizeObserver)
 */

const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/',             heading: /Aegis|Dashboard|Fortress/i },
  { path: '/incidents',    heading: /Incident/i },
  { path: '/signals',      heading: /Signal/i },
  { path: '/clients',      heading: /Client|Pre-Qualification/i },
  { path: '/reports',      heading: /Report/i },
  { path: '/investigations', heading: /Investigation/i },
  { path: '/command-center', heading: /Command/i },
  { path: '/threat-radar', heading: /Threat|Radar/i },
];

for (const { path, heading } of ROUTES) {
  test(`${path} loads without crash`, async ({ authedPage: page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => {
      // Ignore benign browser errors
      if (!err.message.includes('ResizeObserver') && !err.message.includes('Non-Error promise')) {
        jsErrors.push(err.message);
      }
    });

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

    // HTTP must succeed
    expect(response?.status() ?? 200).toBeLessThan(500);

    // Heading or recognisable text must appear
    await expect(
      page.getByRole('heading', { name: heading })
        .or(page.getByText(heading))
        .first()
    ).toBeVisible({ timeout: 12_000 });

    // No raw object dumps
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('[object Object]');

    // No unhandled JS errors
    expect(jsErrors, `JS errors on ${path}: ${jsErrors.join(', ')}`).toHaveLength(0);
  });
}
