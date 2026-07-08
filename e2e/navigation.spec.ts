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

/**
 * /neural-constellation — the one route the loop above never covered, and
 * the origin of #60 (a data-conditional THREE.js fault in the WebGL scene
 * white-screened the WHOLE app via the App-Root ErrorBoundary).
 *
 * The contract here is APP SURVIVAL, not zero JS errors: the 3D scene now
 * has its own ErrorBoundary, so if the intermittent THREE bug fires the
 * scene degrades to <SceneUnavailable> and the error is contained + reported
 * — it never reaches the App-Root boundary. This test therefore asserts the
 * page shell (rendered OUTSIDE the scene boundary) survives and the App-Root
 * crash card is absent. It stays green even while the underlying THREE bug
 * lives; pinning that exact line is the dev-mode-instrument follow-up.
 */
test('/neural-constellation survives (App-Root boundary never trips)', async ({ authedPage: page }) => {
  const response = await page.goto('/neural-constellation', { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 200).toBeLessThan(500);

  // Page shell (the title h1) lives outside the 3D scene boundary — its
  // presence proves the app + page survived even if the WebGL scene errored.
  await expect(
    page.getByRole('heading', { name: /Command Network|Neural Constellation/i }).first()
  ).toBeVisible({ timeout: 12_000 });

  // The App-Root crash fallback must NOT be shown — that white-screen is the
  // exact failure mode #60 fixes. A contained scene error (its own
  // <SceneUnavailable> fallback) is acceptable and does not use this text.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  // No raw object dumps leaked into the DOM.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('[object Object]');
});
