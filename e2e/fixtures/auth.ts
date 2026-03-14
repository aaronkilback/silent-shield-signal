import { test as base, expect, Page } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
// Hardcoded — derived from the Supabase project ref (never changes)
const STORAGE_KEY = 'sb-kpuqukppbmwebiptqmog-auth-token';

export type AuthFixtures = { authedPage: Page };

async function getSupabaseSession(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase auth failed (${res.status}): ${body}`);
  }
  return res.json();
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    // Get a fresh session token via API — no UI form, ~200ms
    const session = await getSupabaseSession(
      process.env.TEST_USER_EMAIL!,
      process.env.TEST_USER_PASSWORD!,
    );

    // Navigate first (page needs an origin before localStorage works)
    await page.goto('/auth');

    // Inject session — pass STORAGE_KEY and session as args, NOT via process.env
    await page.evaluate(
      ([key, s]) => localStorage.setItem(key, JSON.stringify(s)),
      [STORAGE_KEY, session] as [string, unknown],
    );

    // Now navigate to app — should skip auth redirect
    await page.goto('/');
    await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 12_000 });
    await use(page);
  },
});

export { expect };
