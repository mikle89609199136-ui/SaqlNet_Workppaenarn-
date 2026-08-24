import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import path from 'path';

export default defineConfig(({ mode }) => {
  // DEV_API_PROXY_TARGET позволяет проксировать dev-запросы на удалённый стенд
  // вместо локального backend v2. Без VITE_-префикса, чтобы значение не попало
  // в клиентский бандл. По умолчанию — локальный edge-gateway.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.DEV_API_PROXY_TARGET || 'http://localhost:8080';
  const wsTarget = apiTarget.replace(/^http/, 'ws');

  return {
    plugins: [tailwindcss(), react()],
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './client/mobile/react'),
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
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          mobile: resolve(__dirname, 'mobile.html'),
        },
      },
    },
  };
});
