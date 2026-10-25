import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/sessions',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    locale: 'ru-RU',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    env: { DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080' },
  },
});
