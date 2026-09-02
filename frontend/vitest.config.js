import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Алиас повторяет vite.config.ts — без него тесты не резолвят импорты вида @/store
const alias = {
  '@': path.resolve(import.meta.dirname, './src'),
};

// Тесты разделены на два окружения, потому что криптография и DOM несовместимы:
// под jsdom crypto.subtle.importKey падает с TypeError — jsdom не признаёт
// ArrayBuffer, созданный вне своего realm. Файлы с суффиксом .node.test.ts
// выполняются в чистом Node с настоящим WebCrypto, остальные — в jsdom.
const nodePattern = 'src/**/*.node.test.{ts,tsx}';

export default defineConfig({
  test: {
    /* Половина ядер вместо всех. Проектов два, пул воркеров у каждого свой,
       и на двадцатиядерной машине это давало двадцать семь процессов и
       больше трёх гигабайт разом — при занятой памяти прогон падал с
       «Fatal process out of memory: Zone». Это отказ системы выделить
       память, а не превышение кучи, поэтому лечится числом воркеров, а не
       флагом --max-old-space-size.

       Замерено: 27 процессов и 3,19 ГБ за 18 секунд против 18 процессов и
       2,06 ГБ за 21 секунду. Три секунды за треть памяти. */
    maxWorkers: '50%',
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: [nodePattern],
          setupFiles: ['./src/test/setup/msw.ts', './src/test/setup/node.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [nodePattern],
          setupFiles: ['./src/test/setup/msw.ts', './src/test/setup/dom.ts'],
          // ApiClient.buildUrl строит абсолютный URL от origin страницы:
          // без явного адреса jsdom отдаёт about:blank и запросы не собираются.
          environmentOptions: {
            jsdom: { url: 'http://localhost:3000' },
          },
        },
      },
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Детерминированный адрес API: обработчики MSW не должны зависеть от того,
    // есть ли в окружении window.location.
    env: {
      VITE_API_BASE_URL: 'http://localhost:3000/api/v2',
    },
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/types/**'],
    },
  },
});
