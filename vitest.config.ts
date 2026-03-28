import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
    environmentMatchGlobs: [
      ['src/client/__tests__/**/*.test.tsx', 'jsdom'],
    ],
  },
});
