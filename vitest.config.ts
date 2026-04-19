import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'packages/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
    environmentMatchGlobs: [
      ['packages/**/client/__tests__/**/*.test.tsx', 'jsdom'],
      ['packages/shared/components/**/__tests__/**/*.test.tsx', 'jsdom'],
    ],
  },
});
