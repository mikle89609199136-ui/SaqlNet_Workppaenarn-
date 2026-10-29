import { defineConfig, devices } from '@playwright/test';

process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');

// Этот тест проверяет именно локальный Vite proxy, а не удалённый стенд.
export default defineConfig({
  testDir: './tests/ws-proxy',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://127.0.0.1:3000/@vite/client',
    reuseExistingServer: false,
    env: { DEV_API_PROXY_TARGET: 'http://127.0.0.1:8080' },
    timeout: 120_000,
  },
});
