import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path, { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  // DEV_API_PROXY_TARGET позволяет проксировать dev-запросы на удалённый стенд
  // вместо локального backend v2. Без VITE_-префикса, чтобы значение не попало
  // в клиентский бандл. Читается из frontend/.env — vite запускается отсюда.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.DEV_API_PROXY_TARGET || 'http://localhost:8080';
  const wsTarget = apiTarget.replace(/^http/, 'ws');

  return {
    plugins: [tailwindcss(), react()],
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
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
