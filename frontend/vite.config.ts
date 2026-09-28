import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path, { resolve } from 'node:path';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version: string };

/* Тяжёлые библиотеки голосовых (кодировщик, декодер для старого Safari —
   вместе больше 4 МБ) заранее не качаются: грузятся, когда нужны. */
const NOT_PRECACHED = /(opus-ml|encoderWorker|ogg-opus-decoder)/;

/**
 * Service worker (#880): шаблон pwa/sw.js + номер сборки и список файлов
 * оболочки → dist/sw.js. Номер — хеш списка: изменилась сборка — изменился
 * sw.js, и браузер ставит новый worker сам.
 */
function serviceWorker(): Plugin {
  return {
    name: 'craneapp-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const precache = Object.keys(bundle)
        .filter((file) => /^assets\/.+\.(js|css)$/.test(file) && !NOT_PRECACHED.test(file))
        .map((file) => '/' + file)
        .sort();
      precache.push(
        '/locales/ru/translation.json',
        '/locales/en/translation.json',
        '/logo.png',
        '/icons/icon-192.png'
      );
      const buildId = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(resolve(import.meta.dirname, 'pwa/sw.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source:
          `const BUILD_ID = ${JSON.stringify(buildId)};\n` +
          `const PRECACHE_URLS = ${JSON.stringify(precache)};\n` +
          template,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // DEV_API_PROXY_TARGET позволяет проксировать dev-запросы на удалённый стенд
  // вместо локального backend v2. Без VITE_-префикса, чтобы значение не попало
  // в клиентский бандл. Читается из frontend/.env — vite запускается отсюда.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.DEV_API_PROXY_TARGET || 'http://localhost:8080';
  const wsTarget = apiTarget.replace(/^http/, 'ws');

  return {
    plugins: [tailwindcss(), react(), serviceWorker()],
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    /* Версия берётся из манифеста, а не пишется в разметке руками: там
       она устаревает молча — в настройках значилась «Версия 2» при 1.0.0
       в package.json. */
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: wsTarget,
          ws: true,
          // changeOrigin меняет Host, а Origin уходит браузерный — так и надо.
          // Сервер сверяет Origin со списком ALLOWED_ORIGINS, и подменять его
          // здесь значит врать серверу вместо того, чтобы его настроить:
          // адрес дев-сервера должен стоять в списке того окружения, к
          // которому подключаются. Подмена на адрес бэкенда ломала работу с
          // локальным стеком — там в списке localhost:3000, а приезжало
          // localhost:8080, и рукопожатие отклонялось с 403.
          changeOrigin: true,
        },
      },
    },
    build: {
      // Собранный фронтенд остаётся в корневом dist/: на этот путь рассчитывают
      // docker-compose.yml, scripts/start.sh, supervisord.conf и frontendFallback()
      // в backend-v2/cmd/edge. emptyOutDir обязателен, потому что outDir вне корня.
      outDir: '../dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          mobile: resolve(import.meta.dirname, 'mobile.html'),
        },
      },
    },
  };
});
