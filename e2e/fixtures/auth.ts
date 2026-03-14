import { test as base, expect, Page } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;

export type AuthFixtures = {
  authedPage: Page;
};

/**
 * Authenticate directly against Supabase REST API and inject the session
 * into localStorage — zero UI interaction, ~200ms vs ~5s for UI login.
 */
async function getSupabaseSession(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    const session = await getSupabaseSession(
      process.env.TEST_USER_EMAIL!,
      process.env.TEST_USER_PASSWORD!
    );

    // Inject session into Supabase's localStorage key before navigating
    await page.goto('/');
    await page.evaluate((s) => {
      const key = `sb-${new URL(process.env.VITE_SUPABASE_URL || '').hostname.split('.')[0]}-auth-token`;
      localStorage.setItem(key, JSON.stringify(s));
    }, session);

    // Navigate to app — should land on dashboard without auth redirect
    await page.goto('/');
    await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 10000 });
    await use(page);
  },
});

export { expect };
