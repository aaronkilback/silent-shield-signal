import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // serial in CI — single account, avoid session conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                  // 1 worker: Supabase free tier rate limits
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  use: {
    // E2E runs against STAGING (aegis-staging), never prod fortress — no test-user
    // auth against the live client site, no test data on prod. Override with
    // E2E_BASE_URL for local runs. (#57 / #53 governed lane: deploy→staging→E2E→gate)
    baseURL: process.env.E2E_BASE_URL || 'https://aegis-staging.silentshieldsecurity.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
