import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These run against the real Express API and the real database — there is no
 * mocking here. The whole point is to prove the flow works through the seam, so
 * a drift between the front-end's copy of the domain types and the server's
 * shows up as a failure rather than a silent runtime bug.
 *
 * Start the API separately before running:  cd server && npm run dev
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Drives the locally installed Chrome rather than Playwright's bundled
        // Chromium, which has no build for macOS 13 on ARM. On CI, where the
        // bundled browser is available, unset E2E_USE_SYSTEM_CHROME to use it.
        ...(process.env.E2E_USE_SYSTEM_CHROME === 'false'
          ? {}
          : { channel: 'chrome' }),
      },
    },
  ],

  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
