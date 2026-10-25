import { defineConfig, devices } from '@playwright/test';

/** Изолированный локальный стенд. Отдельно от E2E чужих аккаунтов/криптографии. */
export default defineConfig({
  testDir: './tests/appearance',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    locale: 'ru-RU',
    timezoneId: 'UTC',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    env: { DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080' },
  },
});
