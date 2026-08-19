import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, './client/mobile/react/test/setup.js')],
    exclude: ['tests/**/*.cjs', '**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 15000,
  },
});
