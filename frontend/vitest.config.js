import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./client/mobile/react/test/setup.js'],
    exclude: ['tests/**/*.cjs', '**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 15000,
  },
});
