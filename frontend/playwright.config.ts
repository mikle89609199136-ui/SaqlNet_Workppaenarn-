import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-прогон против настоящего браузера.
 *
 * Здесь проверяется только то, чего jsdom не может в принципе: настоящая
 * WebCrypto, настоящая IndexedDB, два независимых пользователя и живой
 * сокет. Всё остальное дешевле и надёжнее проверяется юнит-тестами.
 *
 * Прогон намеренно не входит в обязательные проверки PR: один сценарий
 * «отправил — получил у второго пользователя» занимает десятки секунд, и
 * два десятка таких сделали бы CI непригодным.
 */

// Локальный адрес не должен уходить через корпоративный прокси: с
// заданным HTTP_PROXY и пустым NO_PROXY проверка готовности dev-сервера
// уезжает наружу и не возвращается, а прогон падает по таймауту ещё до
// первого теста.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');

/** Куда стучатся тесты. Dev-сервер Vite проксирует запросы на стенд. */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

/** Свой сервер поднимать не нужно, если тесты идут против уже запущенного. */
const REUSE_RUNNING_SERVER = !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Вход и личный чат готовятся один раз: на /auth/* стоит ограничение
  // частоты, а создание чата в каждом сценарии засоряло бы стенд.
  globalSetup: './e2e/global-setup.ts',
  // Один сценарий — это два браузера, обмен сообщениями и ожидание сокета.
  timeout: 90 * 1000,
  expect: {
    // Сообщение проходит через сервер и возвращается по сокету: ожидание
    // здесь измеряется секундами, а не миллисекундами.
    timeout: 20 * 1000,
  },

  // Тесты пишут в общий стенд: параллельный прогон означал бы, что один
  // сценарий видит чужие сообщения в списке чатов.
  workers: 1,
  fullyParallel: false,

  // Повтор скрывает нестабильность, а нестабильный E2E хуже отсутствующего:
  // его перестают читать. Единственный повтор — на случай сетевого сбоя.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Разбор упавшего сценария без записи почти невозможен: он длинный и
    // воспроизводится только против живого стенда.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: REUSE_RUNNING_SERVER,
    // Первый запуск Vite собирает зависимости: на холодную это минута.
    timeout: 120 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
